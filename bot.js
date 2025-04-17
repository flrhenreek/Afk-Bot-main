const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;
const dns = require('dns').promises;

const config = require('./settings.json');
const loggers = require('./logging.js');
const logger = loggers.logger;

// Több időpont, amikor újracsatlakozik (HH:mm formátumban)
const reconnectTimes = ["02:25", "04:35", "10:00"];
let reconnectAttempts = 0;
let isReconnecting = false; // Állapotjelző, hogy folyamatban van-e újracsatlakozás
let lastReconnectMinute = null; // Az utolsó újracsatlakozási időpont perc alapú követése
const MAX_RECONNECT_ATTEMPTS = 3; // Maximális újrapróbálkozások száma
const BASE_DELAY = 30000; // 10 másodperc alapértelmezett várakozás + 20mp

let isLoggedIn = false;
let hasSpawned = false;

async function createBot() {
   logger.info('Botot létrehoztuk, várjuk a spawn eseményt...');

   const bot = mineflayer.createBot({
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
               bot.chat(`/login ${config.utils['auto-auth'].password}`);
            } else {
               logger.info('Már bejelentkeztünk automatikusan, nincs szükség /login parancsra');
            }
         }, 2000);
      } else {
         logger.info('Már bejelentkeztünk, nincs szükség új /login parancsra');
      }
   });

   bot.on('spawn', () => {
      if (!hasSpawned) {
         logger.info(`🎮 Spawn esemény lefutott`);
         hasSpawned = true;
         reconnectAttempts = 0; // Reseteljük a próbálkozásokat sikeres spawn esetén
         lastReconnectMinute = null; // Reseteljük az időpontot
         isReconnecting = false;
         setTimeout(() => {
            hasSpawned = false;
         }, 5000);
      } else {
         logger.info(`🎮 Ismételt spawn esemény`);
      }
   });
   
   bot.on('error', (err) => {
      logger.error(`${err.message}`);
      isReconnecting = false;
      // Ha hiba történik, várunk a következő időpontra
      const currentTime = new Date();
      const nextReconnectTime = getNextReconnectTime(currentTime);
      const timeToWait = nextReconnectTime - Date.now();
      logger.info(`Hiba történt, következő újracsatlakozási időpont: ${nextReconnectTime.toLocaleTimeString()}, várakozás: ${Math.round(timeToWait / 1000)} másodperc`);
      setTimeout(checkReconnect, timeToWait);
   });

   bot.on('message', (jsonMsg) => {
      const msg = jsonMsg.toString().trim();
      const lower = msg.toLowerCase();
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
         logger.info('Most már a fő szerveren vagyunk - próbálkozunk a GUI navigációval');
         bot.setQuickBarSlot(0);
         bot.activateItem();
         setTimeout(() => {
            logger.info('Megnyitottuk az iránytű GUI-t');
            bot.clickWindow(31, 0, 0);
            setTimeout(() => {
               logger.info('Kattintás a második GUI-n: 2. sor 7. slot (index: 15)');
               bot.clickWindow(15, 0, 0);
            }, 3000);
         }, 4000);
      }, 7000);

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

   bot.on('chat', (username, message) => {
      if (config.utils['chat-log']) {
         logger.info(`<${username}> ${message}`);
      }
   });

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
   
      // Ha már újracsatlakozás folyamatban van, ne indítsunk újat
      if (isReconnecting) {
         logger.warn('Újracsatlakozás már folyamatban van, nem indítunk újat.');
         return;
      }
   
      // Ha a maximális próbálkozások száma elérve, nem próbálkozunk tovább
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
         logger.error(`Maximális (${MAX_RECONNECT_ATTEMPTS}) újrapróbálkozási korlát elérve. Várj kézzel!`);
         reconnectAttempts = 0;
         lastReconnectMinute = null;
         return;
      }
   
      checkReconnect();
   });
   
   bot.on('end', async (reason) => {
      logger.warn('❌ Bot disconnectelt. Reason: ', reason || 'No reason provided');
      isLoggedIn = false;
      hasSpawned = false;
   
      if (isReconnecting) {
         logger.warn('Újracsatlakozás már folyamatban van, nem indítunk újat.');
         return;
      }
   
      // Ha internet miatt dobott le
      if (
         reason?.toString().includes('ECONNRESET') ||
         reason?.toString().includes('ENOTFOUND') ||
         reason?.toString().includes('read') ||
         reason?.toString().includes('socketClosed')
      ) {
         logger.warn('💥 Internet kapcsolat megszakadt. Figyeljük, mikor jön vissza...');
         isReconnecting = true;
         waitForInternetThenReconnect();
         return;
      }
   
      // Ha más okból dobott le
      checkReconnect();
   });

   bot.on('error', (err) => logger.error(`${err.message}`));
}

function checkReconnect() {
   if (isReconnecting) {
      logger.warn('Újracsatlakozás már folyamatban van, nem indítunk újat.');
      return;
   }

   const currentTime = new Date();
   const currentTimeString = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;

   // Ha már próbáltunk ebben a percben, várunk a következő időpontra
   if (lastReconnectMinute === currentTimeString) {
      logger.info(`Már próbáltunk ebben a percben (${currentTimeString}), várunk a következő időpontra...`);
      const nextReconnectTime = getNextReconnectTime(currentTime);
      const timeToWait = nextReconnectTime - Date.now();
      logger.info(`Következő újracsatlakozási időpont: ${nextReconnectTime.toLocaleTimeString()}, várakozás: ${Math.round(timeToWait / 1000)} másodperc`);
      setTimeout(checkReconnect, timeToWait);
      return;
   }

   // Ha az időpont szerepel a reconnectTimes-ban, próbálunk csatlakozni
   if (reconnectTimes.includes(currentTimeString)) {
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
         reconnectAttempts++;
         lastReconnectMinute = currentTimeString; // Jegyezzük fel az időpontot
         logger.info(`Elérkezett az újralépési időpont: ${currentTimeString}, ${reconnectAttempts}. próbálkozás...`);
         isReconnecting = true;
         setTimeout(() => {
            createBot();
         }, BASE_DELAY);
      } else {
         logger.error(`Maximális (${MAX_RECONNECT_ATTEMPTS}) újrapróbálkozási korlát elérve. Várj kézzel!`);
         reconnectAttempts = 0;
         lastReconnectMinute = null;
         isReconnecting = false;
         const nextReconnectTime = getNextReconnectTime(currentTime);
         const timeToWait = nextReconnectTime - Date.now();
         logger.info(`Következő újracsatlakozási időpont: ${nextReconnectTime.toLocaleTimeString()}, várakozás: ${Math.round(timeToWait / 1000)} másodperc`);
         setTimeout(checkReconnect, timeToWait);
      }
   } else {
      const nextReconnectTime = getNextReconnectTime(currentTime);
      const timeToWait = nextReconnectTime - Date.now();
      logger.info(`Következő újracsatlakozási időpont: ${nextReconnectTime.toLocaleTimeString()}, várakozás: ${Math.round(timeToWait / 1000)} másodperc`);
      setTimeout(checkReconnect, timeToWait);
   }
}

function getNextReconnectTime(currentTime) {
   let nextTime = new Date(currentTime);
   const currentTimeString = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;

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
   let checkInterval = 10000; // 10 másodperc
   let maxWaitTime = 5 * 60 * 1000; // 5 perc
   let waited = 0;
   let checkCount = 0;

   const check = async () => {
      const online = await isOnline();

      let serverReachable = false;
      try {
         await dns.lookup(config.server.ip); // DNS ellenőrzés
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
            logger.error('❌ 5 perc eltelt, még mindig nincs net vagy nem elérhető a szerver. Állj le.');
            isReconnecting = false;
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

createBot();