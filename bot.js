const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;
const dns = require('dns').promises;
const readline = require('readline');

const config = require('./settings.json');
const loggers = require('./logging.js');
const logger = loggers.logger;
const servers = config.servers;
let selectedServer = null;

// Több időpont, amikor újraindul (HH:mm formátumban)
let reconnectAttempts = 0;
let isReconnecting = false;
const MAX_RECONNECT_ATTEMPTS = 3;
const BASE_DELAY = 60000; // Növeltük 60 másodpercre a proxy korlátozások miatt

let isLoggedIn = false;
let hasSpawned = false;
let bot = null;

// Readline interfész a felhasználói inputhoz
const rl = readline.createInterface({
   input: process.stdin,
   output: process.stdout,
   prompt: '> '
});

// Felhasználói input kezelése
rl.on('line', (input) => {
   input = input.trim();
   if (!input) return;

   logger.info(`Felhasználói parancs: ${input}`);
   const args = input.split(' ');
   const command = args[0].toLowerCase();

   if (command === '/say' && args.length > 1) {
      const message = args.slice(1).join(' ');
      if (bot && isLoggedIn) {
         bot.chat(message);
         logger.info(`Elküldött üzenet: ${message}`);
      } else {
         logger.warn('Nem lehet üzenetet küldeni, a bot nincs bejelentkezve.');
      }
   } else if (command === '/reconnect') {
      logger.info('Manuális újracsatlakozás indítása...');
      initiateReconnect(true); // Manuális reconnect
   } else if (command === '/quit') {
      logger.info('Bot leállítása...');
      if (bot) {
         try {
            bot.quit('User requested quit');
         } catch (e) {
            logger.error(`Hiba a bot leállítása közben: ${e.message}`);
         }
      }
      rl.close();
      process.exit(0);
   } else {
      logger.warn(`Ismeretlen parancs: ${input}`);
   }

   rl.prompt();
});

async function createBot() {
   logger.info('Botot létrehoztuk, várjuk a spawn eseményt...');

   bot = mineflayer.createBot({
      username: config['bot-account']['username'],
      password: config['bot-account']['password'],
      auth: config['bot-account']['type'],
      host: config.server.ip,
      port: config.server.port,
      version: config.server.version,
   });

   bot.on('login', () => {
      logger.info('✅ Login esemény lefutott');
      if (!isLoggedIn) {
         setTimeout(() => {
            if (!isLoggedIn) {
               logger.info('Bejelentkezés próbálkozás...');
               bot.chat(`/login ${selectedServer.password}`);
            }
         }, 2000);
      }
   });

   bot.on('spawn', () => {
      if (!hasSpawned) {
         logger.info(`🎮 Spawn esemény lefutott`);
         hasSpawned = true;
         reconnectAttempts = 0;
         isReconnecting = false;
         setTimeout(() => {
            hasSpawned = false;
         }, 5000);
      }
   });

   bot.on('message', (jsonMsg) => {
      const msg = jsonMsg.toString().trim();
      logger.info(`[Server] ${msg}`);
      const lower = msg.toLowerCase();
   
      // Itt figyelünk a tiltásra és kapcsolati hibára
      if (lower.includes('Ki vagy tiltva a szerverkről!') || lower.includes('unable to connect')) {
         logger.warn('⚠️ Tiltás vagy kapcsolat hiba észlelve, újracsatlakozás...');
         initiateReconnect(); 
         return; 
      }
   
      // Eddigi login felismerés marad
      if (
         lower.includes('sikeres bejelentkezés') ||
         lower.includes('you have been logged in') ||
         lower.includes('sikeres automatizált bejelentkezés')
      ) {
         isLoggedIn = true;
         logger.info('✅ Sikeresen bejelentkezve!');
         afterLogin();
      }
   });

   function afterLogin() {
      logger.info("Bot joined to the server (login után)");

      if (config.utils['chat-messages'].enabled) {
         logger.info('Started chat-messages module');
         let messages = config.utils['chat-messages']['messages'];
         if (config.utils['chat-messages'].repeat) {
            let delay = config.utils['chat-messages']['repeat-delay'];
            let i = 0;
            setInterval(() => {
               bot.chat(`${messages[i]}`);
               i = (i + 1) % messages.length;
            }, delay * 1000);
         } else {
            messages.forEach((msg) => bot.chat(msg));
         }
      }

      setTimeout(() => {
         logger.info('Login után, várakozás és GUI-navigáció indul');
      
         const delays = selectedServer.delays || {};
      
         setTimeout(() => {
            if (bot) bot.chat(`/login ${selectedServer.password}`);
         }, delays.preLogin || 0);
      
         setTimeout(async () => {
            if (!bot) return;
      
            logger.info('Login + texturepack utáni GUI navigáció kezdése');
      
            for (const step of selectedServer["gui-navigation"] || []) {
               if (step.delay) await new Promise(res => setTimeout(res, step.delay));
      
               if (step.type === "rightClick") {
                  bot.activateItem();
                  logger.info('Jobb klikk aktiválva (pl. lobby belépés)');
               } else if (step.type === "useCompass") {
                  bot.setQuickBarSlot(step.hotbarSlot || 0);
                  bot.activateItem();
                  logger.info(`Iránytű aktiválva a(z) ${step.hotbarSlot + 1}. slotból`);
               } else if (step.type === "clickWindow") {
                  bot.clickWindow(step.slot, 0, 0);
                  logger.info(`ClickWindow slot: ${step.slot}`);
               }
            }
      
         }, (delays.preLogin || 0) + (delays.texturePackLoad || 0) + (delays.postLoginRightClick || 0));
      
      }, 2000); // a login után rögtön

      const pos = config.position;
      if (config.position.enabled) {
         logger.info(`Starting moving to target location (${pos.x}, ${pos.y}, ${pos.z})`);
         bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
      }

      if (config.utils['anti-afk'].enabled && config.utils['anti-afk']['circle-walk'].enabled) {
         function executeWalkAndRotate() {
            bot.setControlState('forward', true);
            bot.look(bot.entity.yaw + 90, bot.entity.pitch, true);
            setTimeout(() => bot.setControlState('forward', false), 2000);
            logger.info('Jártam egyet!');
         }

         function scheduleWalkAndRotate() {
            const randomDelay = Math.floor(Math.random() * (240000 - 60000 + 1)) + 60000;
            setTimeout(() => {
               executeWalkAndRotate();
               scheduleWalkAndRotate();
            }, randomDelay);
         }

         scheduleWalkAndRotate();
      }
   }

   bot.on('goal_reached', () => {
      if (config.position.enabled) {
         logger.info(`Bot arrived to target location. ${bot.entity.position}`);
      }
   });

   bot.on('death', () => {
      logger.warn(`Bot has been died and was respawned at ${bot.entity.position}`);
   });

   bot.on('kicked', (reason) => {
      let reasonText = 'Unknown reason';
      try {
         if (reason && typeof reason === 'string') {
            const parsedReason = JSON.parse(reason);
            reasonText = parsedReason.text || (parsedReason.extra && parsedReason.extra[0] ? parsedReason.extra[0].text : 'No specific reason');
         } else if (reason && typeof reason === 'object' && reason.toString) {
            reasonText = reason.toString().replace(/§./g, '');
         }
      } catch (e) {
         logger.error(`Failed to parse kick reason: ${e.message}`);
      }
      logger.warn(`Bot was kicked from the server. Reason: ${reasonText}`);

      if (isReconnecting) {
         logger.warn('Újracsatlakozás már folyamatban van, nem indítunk újat.');
         return;
      }

      initiateReconnect();
   });

   bot.on('end', async (reason) => {
      logger.warn(`❌ Bot disconnectelt. Reason: ${reason || 'No reason provided'}`);
      isLoggedIn = false;
      hasSpawned = false;

      if (isReconnecting) {
         logger.warn('Újracsatlakozás már folyamatban van, nem indítunk újat.');
         return;
      }

      if (
         reason?.toString().includes('ECONNRESET') ||
         reason?.toString().includes('ENOTFOUND') ||
         reason?.toString().includes('read') ||
         reason?.toString().includes('socketClosed') ||
         reason?.toString().includes('Permissions data') ||
         reason?.toString().includes('already connected') ||
         reason?.toString().includes('logging in too fast')
      ) {
         logger.warn('💥 Kapcsolódási hiba (pl. permissions, hálózat vagy proxy). Újracsatlakozás később...');
         isReconnecting = true;
         waitForInternetThenReconnect();
         return;
      }

      initiateReconnect();
   });

   bot.on('error', (err) => {
      logger.error(`Bot hiba: ${err.message}`);
   });
}

// Periodikus ellenőrzés a reconnectTimes-hoz
function startReconnectCheck() {
   setInterval(() => {
      logger.debug('Periodikus reconnect ellenőrzés...');

      const currentTime = new Date();
      const currentTimeString = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;

      const reconnectTimes = selectedServer.reconnectTimes || [];
      if (reconnectTimes.includes(currentTimeString)) {
         logger.info(`Periodikus ellenőrzés észlelte: ${currentTimeString} újraindítási időpont (${selectedServer.name}).`);
         initiateReconnect();
      }
   }, 60000); // Minden percben ellenőriz
}

function initiateReconnect(isManual = false) {
   if (isReconnecting) {
      logger.warn('Újracsatlakozás már folyamatban van, nem indítunk újat.');
      return;
   }

   const reconnectTimes = selectedServer.reconnectTimes || [];

   isReconnecting = true;
   const currentTime = new Date();
   const currentTimeString = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;

   // Ha időzített újraindítás van, akkor teljesen újraindul
   if (!isManual && reconnectTimes.includes(currentTimeString)) {
      logger.info(`Elérkezett az újraindítási időpont: ${currentTimeString}. A bot teljesen újraindul.`);
      reconnectAttempts = 0;
   } else if (isManual) {
      logger.info('Manuális újracsatlakozás...');
      reconnectAttempts = 0; // Reset kísérletek manuális reconnect esetén
   } else {
      reconnectAttempts++;
   }

   // Meglévő bot leállítása
   if (bot) {
      try {
         bot.quit(isManual ? 'Manual reconnect' : 'Reconnect attempt');
         logger.info('Jelenlegi bot leállítva.');
      } catch (e) {
         logger.error(`Hiba a bot leállítása közben: ${e.message}`);
      }
      bot = null; // Nullázás a biztonság kedvéért
   }

   // Újracsatlakozási logika
   if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS || isManual) {
      logger.info(`Újracsatlakozási kísérlet: ${currentTimeString}, ${reconnectAttempts}. próbálkozás${isManual ? ' (manuális)' : ''}...`);
      setTimeout(() => {
         createBot();
         isReconnecting = false;
      }, BASE_DELAY);
   } else {
      logger.error(`Maximális (${MAX_RECONNECT_ATTEMPTS}) újrapróbálkozási korlát elérve. Várj kézzel!`);
      reconnectAttempts = 0;
      isReconnecting = false;
      const nextReconnectTime = getNextReconnectTime(currentTime);
      const timeToWait = nextReconnectTime - Date.now();
      logger.info(`Következő újracsatlakozási időpont: ${nextReconnectTime.toLocaleTimeString()}, várakozás: ${Math.round(timeToWait / 1000)} másodperc`);
      setTimeout(() => initiateReconnect(), timeToWait);
   }
}

function getNextReconnectTime(currentTime, reconnectTimes = []) {
   let nextTime = new Date(currentTime);
   let reconnectTimesSorted = reconnectTimes
      .map(time => {
         const [hour, minute] = time.split(":");
         nextTime = new Date(currentTime);
         nextTime.setHours(parseInt(hour), parseInt(minute), 0, 0);
         return nextTime;
      })
      .sort((a, b) => a - b);

   let nextReconnectTime = reconnectTimesSorted.find(time => time > currentTime);

   if (!nextReconnectTime) {
      nextReconnectTime = new Date(currentTime);
      nextReconnectTime.setDate(currentTime.getDate() + 1);
      const [hour, minute] = reconnectTimes[0].split(":");
      nextReconnectTime.setHours(parseInt(hour), parseInt(minute), 0, 0);
   }

   return nextReconnectTime;
}

async function waitForInternetThenReconnect() {
   const isOnline = (await import('is-online')).default;
   let checkInterval = 10000;
   let maxWaitTime = 5 * 60 * 1000;
   let waited = 0;
   let checkCount = 0;

   const check = async () => {
      const online = await isOnline();

      let serverReachable = false;
      try {
         await dns.lookup(config.server.ip);
         serverReachable = true;
      } catch (e) {
         serverReachable = false;
      }

      if (online && serverReachable) {
         logger.info('🌐 Internet + szerver elérhető, újracsatlakozás...');
         isReconnecting = false;
         createBot();
      } else {
         waited += checkInterval;
         checkCount++;

         if (waited >= maxWaitTime) {
            logger.error('❌ 5 perc eltelt, még mindig nincs net vagy nem elérhető a szerver. Újracsatlakozás időzítésre vált.');
            isReconnecting = false;
            const currentTime = new Date();
            const nextReconnectTime = getNextReconnectTime(currentTime, reconnectTimes);
            const timeToWait = nextReconnectTime - Date.now();
            logger.info(`Következő újracsatlakozási időpont: ${nextReconnectTime.toLocaleTimeString()}, várakozás: ${Math.round(timeToWait / 1000)} másodperc`);
            setTimeout(() => initiateReconnect(), timeToWait);
            return;
         }

         if (checkCount % 3 === 0) {
            if (!online) {
               logger.info(`🚫 Nincs internet... újrapróbálkozás ${checkInterval / 1000} másodperc múlva`);
            } else if (!serverReachable) {
               logger.info(`🌐 Internet van, de a szerver (${config.server.ip}) még nem elérhető... próbálkozás később`);
            }
         }

         setTimeout(check, checkInterval);
      }
   };

   check();
}

function selectServerAndStart() {
   console.log("Melyik szerveren szeretnél afkolni?");
   servers.forEach((server, index) => {
      console.log(`${index + 1}. ${server.name}`);
   });

   rl.question('Írd be a számot: ', (answer) => {
      const selected = parseInt(answer);
      if (isNaN(selected) || selected < 1 || selected > servers.length) {
         console.log("Érvénytelen választás.");
         rl.close();
         process.exit(1);
      }

      selectedServer = servers[selected - 1];
      config.server = selectedServer;
      createBot();
      startReconnectCheck();
      rl.prompt();
   });
}

selectServerAndStart();