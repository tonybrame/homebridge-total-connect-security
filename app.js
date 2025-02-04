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

this.tcService = new TC_Module(console.log, config);

this.tcService.tcIsArmed(callbackToMe);
//this.tcService.tcArm(callbackToMe);
//this.tcService.tcDisarm(callbackToMe);

function callbackToMe(err, info)
{
    console.log('called back ' + info);
}