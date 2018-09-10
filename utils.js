module.exports = {
    sendSlack: send_slack
}

let key = '';

function send_slack(msg, level, loggerID) {
    if (process.env.C9_PORT) {
        console.log("$C9 OVERRIDE - send_slack disabled");
        return;
    }

    if (key == '') {
        console.log("No Slack Token Provided");
        return;
    }

    if (loggerID) {
        msg = 'loggerID: ' + loggerID + '\n' + msg;
    }

    var icon = ":white_check_mark:";
    if (level == 'warn') icon == ":warning:";
    if (level == 'error') {
        msg = ":bangbang:\n" + msg;
        icon == ":bangbang:";
    }
    var txt = {
        text: msg,
        username: "LOGGER TAIL",
        icon_emoji: icon
    };
    json_post(key, txt);

}


function json_post(url, data, cb) {

    var u = require("url");
    var ob = u.parse(url);

    if (ob.protocol == 'https:') var http = require("https");
    else var http = require("http");

    var options = {
        hostname: ob.host,
        port: ob.port,
        path: ob.path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };

    var req = http.request(options, function (res) {
        //console.log('Status: ' + res.statusCode);
        //console.log('Headers: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (body) {
            //console.log('Body: ' + body);
            if (cb) cb(1, body);
        });
    });
    req.on('error', function (e) {
        //console.log('problem with request: ' + e.message);
        if (cb) cb(0, e);
    });
    // write data to request body
    req.write(JSON.stringify(data));
    req.end();

}
