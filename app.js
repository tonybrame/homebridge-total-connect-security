/*
 * This file was just used for testing the tc_connect class
 * */

var http = require('http');
var TC_Module =  require('./lib/tc_connect');

var config = [];

config["username"] = "user";
config["password"] = "pass";
config["appID"] = "16808";
config["version"] = "3.42.1.106";

runit();

async function runit() {

    this.tcService = new TC_Module(console.log, config);

    console.log("Start");

    this.tcService.tcIsArmed(callbackToMe);
    //this.tcService.tcArm(callbackToMe);
    //this.tcService.tcDisarm(callbackToMe);

    await sleeeeep(5000); // Sleep for 5 seconds

    this.tcService.tcIsArmed(callbackToMe);

    // await sleeeeep(110000); // Sleep for under 119 seconds, but long enough to trigger a refresh.

    // this.tcService.tcIsArmed(callbackToMe);

    //if I sleep for 2 minutes, i will kill the session, and get a new token. (timeout is 119 seconds)
    await sleeeeep(120000); 

    this.tcService.tcIsArmed(callbackToMe);
    
    //testing sleep for 10 minutes, should refresh the token a lot... 
    await sleeeeep(120000 * 5); 

    console.log("End");
}

function sleeeeep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function callbackToMe(err, info)
{
    console.log('called back ' + info);
}