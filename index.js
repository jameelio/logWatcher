const fs = require("fs"),
    moment = require('moment'),
    notify = require('./utils.js'),
    as = require('async-file'),
    util = require('util'),
    childProcess = require('child_process'),
    exec = util.promisify(childProcess.exec);

// APP Config
let CONFIG = {};
const CONFIG_FILE = "config.json";
const DEFAULT_CONFIG = {
    filePath: '/home/pi/wilite-modem/logs/',
    differenceReportOn: 6000, //differnece greater than 1minute then report
    checkdifferenceEvery: 30000, //every 30seconds
    quietTimePeriodNight: { start: "21:00:00", end: "23:59:59" },
    quietTimePeriodMorning: { start: "00:00:00", end: "08:59:59" },
    id: ""
};

const FILE = {
        UPDATED_NAME: null,
        CREATED_NAME: null,
        REMOVED_NAME: null

    },
    FILE_TIME = {
        MODIFIED_EPOCH: 0,
        CREATED_EPOCH: 0
    },
    FILE_STATE = {
        UPDATE: 'update',
        DELETE: 'delete',
        CREATE: 'create'
    }

const SYSTEM_STATE_INITIALIZING = "INITIALIZING LOG CONFIG...",
    SYSTEM_STATE_INITIALIZING_FILE_WATCH = "INITIALIZING FILE WATCH",
    USER_REPORT_MESSAGE_OUT_OF_SYNC = 'LOG FILE UPDATED AND CURRENT DAY LOG ARE OUT OF SYNC',
    USER_REPORT_MESSAGE_IN_SYNC = 'LOG FILE UPDATED AND CURRENT DAY LOG ARE IN SYNC',
    USER_REPORT_MESSAGE_FILE_CREATED_NULL = " LOG FILE CREATED IS NULL, BUT LOG FILE UPDATE IS NOT",
    USER_REPORT_MESSAGE_TOO_QUIET = 'HEADS UP! BEEN QUIET, SINCE LAST EDIT,CHECK LOGS',
    USER_REPORT_MESSAGE_FILE_CONTENT_NULL = 'FILE CREATED,FILE.REMOVED_NAME &FILE.UPDATED_NAME ARE EQUAL TO NULL',
    SYSTEM_STATE_FILE_NOT_EXIST = 'FILE DOES NOT EXIST',
    SYSTEM_STATE_FILENAME_NOT_PROVIDED = "FILE NAME NOT PROVIDED",
    SYSTEM_STATE_FILE_UPDATE = 'FILE UPDATE',
    SYSTEM_STATE_FILE_REMOVE = 'FILE REMOVE',
    SYSTEM_STATE_FILE_CREATE = 'FILE REMOVE',
    SYSTEM_STATE_CURRENT_DAY = 'CURRENT DAY',
    WARNING_RESTART = 'RESTARTING TSHARK PROCESS VIA PM2';

let LOG_FLAG = null,
    ALERT_SENT = 0,
    SEND_LIMIT = 5;

let QUIET_MORNING_TIME,
    QUIET_NIGHT_TIME;

let CURRENT_DAY = moment().format('YYMMDD');

let MSG = { LASTEDIT: null, MESSAGE: null };

(async() => {

    console.log(SYSTEM_STATE_INITIALIZING);

    CONFIG = loadConfig();
    if (CONFIG.id !== 'default') {
        storeConfig(CONFIG);
    }

    notify.sendSlack(SYSTEM_STATE_INITIALIZING_FILE_WATCH, '', CONFIG.id);

    QUIET_NIGHT_TIME = {
        start: CONFIG.quietTimePeriodNight.start,
        end: CONFIG.quietTimePeriodNight.end
    }

    QUIET_MORNING_TIME = {
        start: CONFIG.quietTimePeriodMorning.start,
        end: CONFIG.quietTimePeriodMorning.end,
    }

    await initiateFileWatch();
    await readFileStat();

    setInterval(() => {
        reportFileDif();
        reportDayFile();
    }, CONFIG.checkdifferenceEvery)

})();

async function initiateFileWatch() {
    try {
        await as.watch(CONFIG.filePath, async(event, filename) => {

            if (filename) {
                if (event == "change") {
                    let type = FILE_STATE.UPDATE;
                    readFileStat(filename, type);
                }
                if (event == "rename") {
                    let type;
                    let exist = await as.exists(CONFIG.filePath + filename);
                    if (exist == true) type = FILE_STATE.CREATE;
                    else type = FILE_STATE.DELETE
                    readFileStat(filename, type);
                }
            }
            else {
                console.log(SYSTEM_STATE_FILENAME_NOT_PROVIDED);
                LOG_FLAG = 0;
                MSG.MESSAGE = SYSTEM_STATE_FILENAME_NOT_PROVIDED;
            }
        });
    }
    catch (e) {
        console.log(SYSTEM_STATE_FILE_NOT_EXIST);
        LOG_FLAG = 0;
        MSG.MESSAGE = SYSTEM_STATE_FILE_NOT_EXIST;
    }
}

function readFileStat(file, type) {
    try {
        fs.stat(CONFIG.filePath, async(event, stat) => {
            setFileState(file, stat, type)
        });
    }
    catch (e) {
        console.log(e);
    }
}

function setFileState(file, currentStat, changeType) {
    switch (changeType) {

    case 'update':
        console.log(SYSTEM_STATE_FILE_UPDATE);
        FILE.UPDATED_NAME = file;
        FILE_TIME.MODIFIED_EPOCH = moment().valueOf();
        break;

    case 'create':
        console.log(SYSTEM_STATE_FILE_CREATE)
        FILE.CREATED_NAME = file
        FILE_TIME.CREATED_EPOCH = moment().valueOf();
        break;

    case 'delete':
        console.log(SYSTEM_STATE_FILE_REMOVE);
        FILE.REMOVED_NAME = file
        break;
    }
}

function reportFileDif() {

    let currentTime = moment().valueOf();
    let milliSecondDifference = currentTime - FILE_TIME.MODIFIED_EPOCH;

    if (milliSecondDifference > CONFIG.differenceReportOn) {
        if (LOG_FLAG == 0) {
            onFlagZeroReport();
        }
        if (LOG_FLAG == 1) {
            onFlagOneReport(milliSecondDifference);
        }
    }
}


function onFlagZeroReport() {

    let c = moment().format('HH:mm:ss');

    if (quietTimeFilter(c)) return;
    if (ALERT_SENT == SEND_LIMIT) {
        notify.sendSlack(WARNING_RESTART, 'warning', CONFIG.id);
        exec('pm2 restart modem');
        return;
    }

    notify.sendSlack(MSG.MESSAGE, 'error', CONFIG.id);
    console.log(MSG);

    ALERT_SENT++;
}

function onFlagOneReport(dif) {

    let c = moment().format('HH:mm:ss');
    if (quietTimeFilter(c)) return;
    if (ALERT_SENT == SEND_LIMIT) {
        notify.sendSlack(WARNING_RESTART, 'warning', CONFIG.id);
        exec('pm2 restart modem');
        return;
    }

    MSG.LASTEDIT = ago(dif);
    MSG.MESSAGE += " " + USER_REPORT_MESSAGE_TOO_QUIET + " " + MSG.LASTEDIT;

    notify.sendSlack(MSG.MESSAGE, 'warning', CONFIG.id);
    console.log(MSG);
    ALERT_SENT++;
}

function reportDayFile() {
    CURRENT_DAY = moment().format('YYMMDD');

    if (!FILE.CREATED_NAME && !FILE.REMOVED_NAME && !FILE.UPDATED_NAME) {
        LOG_FLAG = 0;;
        MSG.MESSAGE = USER_REPORT_MESSAGE_FILE_CONTENT_NULL;
    }

    if (FILE.CREATED_NAME == null && FILE.UPDATED_NAME != null) {
        LOG_FLAG = 0;
        MSG.MESSAGE = USER_REPORT_MESSAGE_FILE_CREATED_NULL;
    }

    if (FILE.UPDATED_NAME !== null && FILE.UPDATED_NAME !== CURRENT_DAY) {
        LOG_FLAG = 0;
        MSG.MESSAGE = USER_REPORT_MESSAGE_OUT_OF_SYNC;
    }

    if (CURRENT_DAY === FILE.UPDATED_NAME) {
        LOG_FLAG = 1;
        MSG.MESSAGE = USER_REPORT_MESSAGE_IN_SYNC;
    }

    if (FILE.REMOVED_NAME !== null) {
        LOG_FLAG = 0;
        MSG.MESSAGE = SYSTEM_STATE_FILE_REMOVE;
    }
}

function quietTimeFilter(inTime) {
    var morning = null;
    var evening = null;

    if (!QUIET_NIGHT_TIME && !QUIET_MORNING_TIME) {
        return false;
    }

    morning = checkPeriod(QUIET_MORNING_TIME.start, QUIET_MORNING_TIME.end, inTime)
    evening = checkPeriod(QUIET_NIGHT_TIME.start, QUIET_NIGHT_TIME.end, inTime);

    if (morning) {
        return true;
    }

    if (evening) {
        return true;
    }
    return false;
}

//===================================================================================================
//General Methods

function loadConfig() {
    let config = null;
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE).toString());
    }
    catch (e) {}

    if (config == null) {
        config = DEFAULT_CONFIG;
    }
    else {
        //ensure config loaded has all default config keys
        for (let key in DEFAULT_CONFIG) {
            if (!config.hasOwnProperty(key)) {
                config[key] = DEFAULT_CONFIG[key];
            }
        }
    }
    return config;
}

function storeConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
}

function ago(milli) {

    let x = milli;
    let d = moment.duration(x, 'milliseconds');
    let hours = Math.floor(d.asHours());
    let mins = Math.floor(d.asMinutes()) - hours * 60;
    let seconds = Math.floor(d._data.seconds);
    let timeSnd = (hours + "hours" + mins + "mins" + seconds + "seconds")

    return timeSnd;
}

function checkPeriod(start, end, now) {
    let format = 'hh:mm:ss';

    now = moment(now, format);
    start = moment(start, format);
    end = moment(end, format);

    if (now.isBetween(start, end)) {
        return true;
    }
    return false;
}
