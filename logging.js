const log4js = require("log4js");
log4js.configure({
    appenders: {
        console: {
            type: "console",
            layout: {
                type: 'pattern',
                pattern: '%d{hh:mm:ss} %-5p - %m' // egyszerűbb, de jól olvasható
            }
        }
    },
    categories: {
        default: {
            appenders: ["console"],
            level: "info"
        }
    }
});

const logger = log4js.getLogger();

module.exports = {
    logger
}
