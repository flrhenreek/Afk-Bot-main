const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock, GoalXZ } = require('mineflayer-pathfinder').goals;

const config = require('./settings.json');
const loggers = require('./logging.js');
const logger = loggers.logger;

// Több időpont, amikor újracsatlakozik (HH:mm formátumban)
const reconnectTimes = ["02:25", "04:35", "10:00"];  

function createBot() {
   const bot = mineflayer.createBot({
      username: config['bot-account']['username'],
      password: config['bot-account']['password'],
      auth: config['bot-account']['type'],
      host: config.server.ip,
      port: config.server.port,
      version: config.server.version,
   });

   function startSwing(bot) {
      setInterval(() => {
         bot.swingArm('right');
         logger.info('Ütöttem!');
      }, 120000);
   }

   bot.on('error', (err) => {
      logger.error('Bot encountered an error: ' + err);
   });

   bot.on('end', () => {
      logger.info('Bot disconnected');
      checkReconnect();  // Ellenőrizzük, hogy elérkezett-e az újralépési időpont
   });

   // Automatikus login figyelés üzenet alapján
   bot.on('message', (jsonMsg) => {
      const msg = jsonMsg.toString().toLowerCase();
      logger.info('Szerver üzenet: ' + msg);

      const loginNeeded = msg.includes('/login') ||
                          msg.includes('azonosítsd') ||
                          msg.includes('jelszó') ||
                          msg.includes('jelentkezz be') ||
                          msg.includes('please login') ||
                          msg.includes('authenticate');

      if (loginNeeded && config.utils['auto-auth'].enabled) {
         const password = config.utils['auto-auth'].password;
         logger.info('Szerver bejelentkezést kér - küldjük a /login parancsot...');
         bot.chat(`/login ${password}`);
      }
   });

   bot.once('spawn', () => {
      logger.info("Bot joined to the server");

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
         logger.info('Most már a fő szerveren vagyunk – próbálkozunk a GUI navigációval');

         bot.setQuickBarSlot(0);
         bot.activateItem();

         setTimeout(() => {
            logger.info('Megnyitottuk az iránytű GUI-t');
            bot.clickWindow(31, 0, 0);

            setTimeout(() => {
               logger.info('Kattintás a második GUI-n: 2. sor 7. slot (index: 15)');
               bot.clickWindow(15, 0, 0);
            }, 3000);

         }, 2000);

      }, 7000);

      const pos = config.position;

      if (config.position.enabled) {
         logger.info(`Starting moving to target location (${pos.x}, ${pos.y}, ${pos.z})`);
         bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
      }

      if (config.utils['anti-afk'].enabled) {
         if (config.utils['anti-afk'].sneak) {
            bot.setControlState('sneak', true);
         }

         if (config.utils['anti-afk'].jump) {
            bot.setControlState('jump', true);
         }

         if (config.utils['anti-afk']['hit'].enabled) {
            let delay = config.utils['anti-afk']['hit']['delay'];
            let attackMobs = config.utils['anti-afk']['hit']['attack-mobs'];

            setInterval(() => {
               if (attackMobs) {
                  let entity = bot.nearestEntity(e => e.type !== 'object' && e.type !== 'player'
                     && e.type !== 'global' && e.type !== 'orb' && e.type !== 'other');

                  if (entity) {
                     bot.attack(entity);
                     return;
                  }
               }

               bot.swingArm("right", true);
            }, delay);
         }

         if (config.utils['anti-afk'].rotate) {
            setInterval(() => {
               bot.look(bot.entity.yaw + 1, bot.entity.pitch, true);
            }, 100);
         }

         if (config.utils['anti-afk']['circle-walk'].enabled) {
            let radius = config.utils['anti-afk']['circle-walk']['radius'];
            circleWalk(bot, radius);
         }
      }
   });

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

function circleWalk(bot, radius) {
   return new Promise(() => {
      const pos = bot.entity.position;
      const x = pos.x;
      const y = pos.y;
      const z = pos.z;

      const points = [
         [x + radius, y, z],
         [x, y, z + radius],
         [x - radius, y, z],
         [x, y, z - radius],
      ];

      let i = 0;
      setInterval(() => {
         if (i === points.length) i = 0;
         bot.pathfinder.setGoal(new GoalXZ(points[i][0], points[i][2]));
         i++;
      }, 1000);
   });
}

createBot();
