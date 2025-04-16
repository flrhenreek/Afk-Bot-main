const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock, GoalXZ } = require('mineflayer-pathfinder').goals;

const config = require('./settings.json');
const loggers = require('./logging.js');
const logger = loggers.logger;

// Több időpont, amikor újracsatlakozik (HH:mm formátumban)
const reconnectTimes = ["02:25", "04:35", "10:00"];  

let isLoggedIn = false;
let hasSpawned = false;

function createBot() {
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
            if (!isLoggedIn) { // Dupla ellenőrzés, hátha közben automatikusan bejelentkezett
               logger.info('Bejelentkezés próbálkozás...');
               bot.chat(`/login ${config.utils['auto-auth'].password}`);
            } else {
               logger.info('Már bejelentkeztünk automatikusan, nincs szükség /login parancsra');
            }
         }, 2000); // 2 másodperc várakozás az automatikus bejelentkezés üzenetére
      } else {
         logger.info('Már bejelentkeztünk, nincs szükség új /login parancsra');
      }
   });

   bot.on('spawn', () => {
      if (!hasSpawned) {
         logger.info(`🎮 Spawn esemény lefutott`);
         hasSpawned = true;
         setTimeout(() => {
            hasSpawned = false; // Reseteljük egy idő után, hogy új spawn eseményeket kezelhessünk
         }, 5000); // 5 másodperc után újra engedélyezzük
      } else {
         logger.info(`🎮 Ismételt spawn esemény`);
      }
   });

   bot.on('end', () => {
      logger.warn('❌ Bot disconnectelt');
      isLoggedIn = false;
      hasSpawned = false;
      if (config.utils['auto-reconnect']) {
         setTimeout(() => {
            logger.info('Újracsatlakozási kísérlet...');
            createBot();
         }, config.utils['auto-reconnect-delay'] || 5000);
      } else {
         checkReconnect();
      }
   });

   bot.on('message', (jsonMsg) => {
      const msg = jsonMsg.toString().trim().toLowerCase();
      if (msg === '') {
         return;
      }
      logger.info(`Szerver üzenet: ${msg}`);
   
      if (msg.includes('sikeres bejelentkezés') || 
          msg.includes('you have been logged in') || 
          msg.includes('sikeres automatizált bejelentkezés')) {
         isLoggedIn = true;
         logger.info('✅ Sikeresen bejelentkezve!');
         afterLogin(); // Közvetlenül hívjuk az afterLogin-t
      }
   });

   function afterLogin() {
   logger.info("Bot joined to the server (login után)");

   // Chat üzenetek
   if (config.utils['chat-messages'].enabled) {
      logger.info('Started chat-messages module');
      let messages = config.utils['chat-messages']['messages'];

      if (config.utils['chat-messages'].repeat) {
         let delay = config.utils['chat-messages']['repeat-delay'];
         let i = 0;

         setInterval(() => {
            bot.chat(`${messages[i]}`);
            if (i + 1 === messages.length) {
               i = 0;
            } else i++;
         }, delay * 1000);
      } else {
         messages.forEach((msg) => {
            bot.chat(msg);
         });
      }
   }

   // Várakozás a szerver átirányítására
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
         // Function to simulate a short walk and rotation
         function executeWalkAndRotate() {
            // Start walking forward
            bot.setControlState('forward', true);
            // Rotate slightly (90 degrees)
            bot.look(bot.entity.yaw + 90, bot.entity.pitch, true);
            // Stop walking after 2 seconds
            setTimeout(() => bot.setControlState('forward', false), 2000);
            logger.info('Jártam egyet!')
         }
      
         // Function to schedule the next walk at a random interval between 1-4 minutes
         function scheduleWalkAndRotate() {
            const minDelay = 60000; // 1 minute in milliseconds
            const maxDelay = 240000; // 4 minutes in milliseconds
            const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            setTimeout(() => {
               executeWalkAndRotate();
               scheduleWalkAndRotate(); // Schedule the next execution
            }, randomDelay);
         }
      
         // Start the first schedule
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

   if (config.utils['auto-reconnect']) {
      bot.on('end', () => {
         setTimeout(() => {
            createBot();
         }, config.utils['auto-reconnect-delay']);
      });
   }

   bot.on('kicked', (reason) => {
      let reasonText = JSON.parse(reason).text;
      if (reasonText === '') {
         reasonText = JSON.parse(reason).extra[0].text;
      }
      reasonText = reasonText.replace(/§./g, '');
      logger.warn(`Bot was kicked from the server. Reason: ${reasonText}`);
   });

   bot.on('error', (err) =>
      logger.error(`${err.message}`)
   );
}

// Ellenőrzi, hogy elérkezett-e valamelyik napi újralépési időpont
function checkReconnect() {
   const currentTime = new Date();
   const currentTimeString = currentTime.getHours().toString().padStart(2, '0') + ':' + currentTime.getMinutes().toString().padStart(2, '0');

   // Ha a jelenlegi időpont megegyezik bármelyik újralépési időponttal, újracsatlakozik
   if (reconnectTimes.includes(currentTimeString)) {
      logger.info(`Elérkezett az újralépési időpont: ${currentTimeString}, újracsatlakozás...`);
      createBot();
   } else {
      // Ha még nem jött el a megfelelő időpont, akkor várjunk
      let nextReconnectTime = getNextReconnectTime(currentTimeString);
      const timeToWait = nextReconnectTime - Date.now();
      setTimeout(checkReconnect, timeToWait);
   }
}

// Kiszámítja a következő újralépési időpontot
function getNextReconnectTime(currentTimeString) {
   const currentTime = new Date();
   let nextTime = new Date(currentTime);
   let nextReconnectTime = reconnectTimes
      .map(time => {
         const [hour, minute] = time.split(":");
         nextTime.setHours(hour);
         nextTime.setMinutes(minute);
         return nextTime;
      })
      .find(time => time > currentTime);

   if (!nextReconnectTime) {
      nextReconnectTime = new Date(currentTime.setDate(currentTime.getDate() + 1));
   }

   return nextReconnectTime;
}

createBot();
