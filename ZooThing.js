//ZooThing module for ESP8266 provides interface
//for automatically connect, reconnect to WiFi if connection is lost
//and set ssid, password and thing name for connection.
//use start(connectCallback, disconnectCallback) for start (you dont need stop)
//just use connect() and settings() when necessary

//TODO: MQTT support
//TODO: crypt saved settings
//TODO: make settings page more beauty
//TODO: make settings for TICK, recconnect attempts etc.
//TODO: make different massageLoop module 

var wifi = require('Wifi');
var http = require('http');
var storage = require('Storage');

const VERSION = 0.11;
const DEFAULT_NAME = 'ZooPet';
const SETTINGS_FILENAME = 'zooset';

var TICK = 500;  
var APLIFETIME = 1000 * 60 * 5; //5 minutes for AP and settings
var RECONNECTS = 5;
var RECONNECTTIME = 1000 * 10; //10 seconds for reconnect attemps

var Thing = {
  name : DEFAULT_NAME,
  ssid : 'default_ssid',
  pass : 'default_password',
  appass : '',
};

var Context = {
  connected : false,
  reconnect : 0,
  server : null,
  loopTimer : 0
  connectCallback : null,
  disconnectCallback : null
};

//define messages enum
const MSG = {
  FIRST : 0,
  INIT : 1,
  CONNECT : 2,
  DISCONNECTED : 3,
  GETIP : 4,
  SKIP : 5, //skip one message, one tick do nothing
  APSTARTED : 6, 
  APSTOP : 7,
  STARTAP : 8,
  STOPSERVER : 9,
  SAVESETTINGS : 10,
  CONNECTED : 11,
  RECONNECT : 12,
  LAST : 255
};

//message is a object with 2 fields: msg and param. param is object with named params

//define messages queue
var zoo_queue = [];

//define sendMessage
function sendMessage(message, params) {
  zoo_queue.push({ msg : message, param: params});
}

//define getMessage
function getMessage() {
  return zoo_queue.shift();
}

//handlers
function logo(br) {
  if (!br)
      br = "\n";
  return "ZooThings framework version " + VERSION + br +
         "(c) 2018 Mr.Parker" + br;
}

function connect() {
  console.log('connecting ' + Thing.ssid + '...');
  wifi.setHostname(Thing.name);
  wifi.connect(Thing.ssid, { password: Thing.pass }, function(error) {
          if (error) {
                console.log(error);
                sendMessage(MSG.DISCONNECTED);
            } else {
                wifi.stopAP();
                let name = wifi.getHostname();
                Context.connected = true;
                Context.reconnect = 0;
                console.log('connected as ', name);
                sendMessage(MSG.SKIP);
                sendMessage(MSG.SKIP);
                sendMessage(MSG.SKIP);
                sendMessage(MSG.GETIP);
                sendMessage(MSG.CONNECTED);
            }
  });
}

function connected() {
	console.log('wifi connected');
	if (Context.connectCallback) {
	  Context.connectCallback();
	}
}

function disconnected() {
	console.log('wifi disconnected');

	if (Context.disconnectCallback) {
	  Context.disconnectCallback();
	}
	sendMessage(MSG.RECONNECT);
}

function startAP() {
  wifi.stopAP();
  let options = { password: Thing.appass };
  options.authMode = Thing.appass.length ? 'wpa2' : 'open';
  console.log('starting AP...');
  wifi.startAP(Thing.name, options, function(err) {
    if (err) {
      console.log('.');
      sendMessage(MSG.STARTAP);
    } else {
      console.log(Thing.name + ' AP started for ' + APLIFETIME/1000/60 + ' min');
      let ap = wifi.getAPDetails();
      let with_or_without = Thing.appass.length ? ' with pass ' + ap.password : ' without password';
      console.log('connect to ' + ap.ssid + with_or_without);
      sendMessage(MSG.APSTARTED);
      setTimeout(function() { sendMessage(MSG.APSTOP); }, APLIFETIME);
    }
  });
}

function reconnect() {
  if (Context.reconnect < RECONNECTS) {
    Context.reconnect++;
    console.log("waiting " + RECONNECTTIME/1000 + " sec for reconnect attempt " + Context.reconnect + "...");
    setTimeout( function() { sendMessage(MSG.CONNECT); }, RECONNECTTIME); 
  } else {
    console.log('no connection, start AP for settings...');
    sendMessage(MSG.STARTAP);
  }
}

function stopServer() {
  if (Context.server) {
    Context.server.close();
  }
  wifi.stopAP();
}

function stopSettings() {
  if (Context.connected) 
    return; 
  stopServer(); 
  if (Thing.name == DEFAULT_NAME) {
      console.log('pet name is no changed. AP stopped. please restart device...');  
  } else {
      console.log('AP stopped. we will wait ' + (APLIFETIME/1000/60) * 3 + ' min and try to reconnect');
      setTimeout(function() { sendMessage(MSG.CONNECT); }, APLIFETIME * 3);
  }
}

function getIP() {
  console.log("IP address: " + wifi.getIP().ip);
}

wifi.on('disconnected', function(details) {
  if (!Context.connected) 
     return;
  console.log('disconnected: ' + details);
  Context.connected = false;
  sendMessage(MSG.DISCONNECTED);
});

var settings_html = "<!DOCTYPE html>\n<html>\n<head>\n\t<title>$title</title>\n</head>\n<body>\n<form action=/set method=\"get\">\n$logo\nname: <input type=text name=\"thing\" value=$thing><br>\nWiFi: <input type=text name=\"ssid\" value=$ssid><br>\npass: <input type=password name=\"pass\" value=$pass><br>\nAP pass: <input type=password name=\"appass\" value=$appass><br>\n<p><input type=\"submit\"></p>\n</form>\n</body>\n</html>\n";

function prepareHTML() {
  let html = settings_html;
  html = html.replace('$title', Thing.name);
  html = html.replace('$logo', logo("<br>"));
  html = html.replace('$thing', Thing.name);
  html = html.replace('$ssid', Thing.ssid);
  html = html.replace('$pass', Thing.pass);
  html = html.replace('$appass', Thing.appass);
  return html;
}

function onPage(req, res) {
  let rurl = url.parse(req.url, true);

  if (rurl.pathname == "/") {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(prepareHTML()); 
  } else if (rurl.pathname == "/set") {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    Thing.name = rurl.query.thing;
    Thing.ssid = rurl.query.ssid;
    Thing.pass = rurl.query.pass;
    let message = '';
    if (rurl.query.appass != Thing.appass && rurl.query.appass.length < 8) {
      message = 'WARNING: AP password must be at least 8 characters\n';
    } else {
      Thing.appass = rurl.query.appass;
    }
    message = message + "settings updates, trying to reconnect...";
    res.end(message);
    console.log(message);
    sendMessage(MSG.SAVESETTINGS);
    sendMessage(MSG.STOPSERVER);
    sendMessage(MSG.CONNECT);
  } else {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end("not found");
  }
}

function startSettings() {
  if (!Context.server)
      Context.server = http.createServer(onPage);
  Context.server.listen(80);
  console.log('open in browser http://' + wifi.getAPIP().ip);
}

function saveSettings() {
  console.log('saving settings...');
  if (!storage.write(SETTINGS_FILENAME, Thing)) {
    console.log('save error');
  } else {
    console.log('saved');  
  }
}

function loadSettings() {
  console.log('loading settings...');
  let s = storage.readJSON(SETTINGS_FILENAME);
  if (s) {
    Thing = s;
    console.log('loaded');   
  } else {
    console.log('no saved settings');
  }
}

function settings() {
  sendMessage(MSG.STARTAP);
}

function init() {
  console.log(logo());
  console.log('use settings() call from console for settings');
  console.log('use connect() call from console for connect');  
  Context.reconnect = 0;
  console.log('starting...'); 
  loadSettings();
  if (Thing.name == DEFAULT_NAME) {
      console.log('first your must name your pet...');
      settings();
  } else {
      sendMessage(MSG.CONNECT);
  }
}

//define messageLoop {
function messageSwitch() {
//  getMessage
  let msg = getMessage();
  
  if (msg) {
    
//  call overloaded virtual message handler 

//  if overloaded virtual message handler return true (message handled) - return from messageLoop

//  else switch on messages
    switch(msg.msg) {
      case MSG.INIT:
        init();
        break;
      case MSG.CONNECT:
        connect();
        break;
      case MSG.CONNECTED:
        connected();
        break;        
      case MSG.DISCONNECTED:
        disconnected();
        break;
      case MSG.RECONNECT:
        reconnect();
        break;
      case MSG.STARTAP:
        startAP();
        break;
      case MSG.APSTARTED:
        startSettings();
        break;
      case MSG.APSTOP:
        stopSettings();
        break;
      case MSG.STOPSERVER:
        stopServer();
        break;
      case MSG.SAVESETTINGS:
        saveSettings();
        break;
      case MSG.GETIP:
        getIP();
        break;
      case MSG.SKIP:
        console.log('.');
        break;
      default:
        console.log('unknown message ' + msg.msg);
      }
  }
}

function messageLoop() {
  if (Context.loopTimer) {
    clearInterval(Context.loopTimer);
  }
  Context.loopTimer = setInterval(messageSwitch, TICK);
}

//start messageLoop 
function start(connectCallback, disconnectCallback) {
	Context.connectCallback = connectCallback;
	Context.disconnectCallback = disconnectCallback;
	sendMessage(MSG.INIT);
	messageLoop();
}

exports.connect = connect;
exports.settings = settings;
exports.start = start;
exports.name = thing.name;
