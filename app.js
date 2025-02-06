/*
 * This file was just used for testing the tc_connect class
 * */

var http = require('http');
var TC_Module =  require('./lib/tc_connect');

var config = [];

config["username"] = "xxxx";
config["password"] = "xxxx";
config["appID"] = "14588";
config["version"] = "1.0.0";

runit();

async function runit() {

    this.tcService = new TC_Module(console.log, config);

    console.log("Start");
    this.tcService.tcIsArmed(callbackToMe);
    //this.tcService.tcArm(callbackToMe);
    //this.tcService.tcDisarm(callbackToMe);

    await sleeeeep(5000); // Sleep for 5 seconds

    this.tcService.tcIsArmed(callbackToMe);

    //if I sleep for 3 minutes, i get a 401 unauth error
    await sleeeeep(180000); // Sleep for 10 seconds ... 3 minutes.

    this.tcService.tcIsArmed(callbackToMe);
    
    console.log("End");
}

function sleeeeep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function callbackToMe(err, info)
{
    console.log('called back ' + info);
}