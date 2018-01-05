var Service, Characteristic;
var TC_Module =  require('./lib/tc_connect');

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-total-connect-security", "TotalConnectSecurity", TC2Accessory);
}

/*
{
        "accessory": "TotalConnectSecurity",
        "name": "Security System",
        "username": "my_username",
        "password": "xxx",
        "appID": "14588",
        "version": "1.0.0"
   }
* */

function TC2Accessory(log, config) {

    this.log = log;
    this.name = config["name"];


    this.tcService = new TC_Module.TC_Connect(this.log, config);

    this.service = new Service.Switch(this.name);

    this.service
        .getCharacteristic(Characteristic.On)
        .on("get", this.getState.bind(this))
        .on("set", this.setState.bind(this));
}

TC2Accessory.prototype.getState = function(callback) {
    this.log("Getting current state...");

    this.tcService.tcIsArmed(callback);

}

TC2Accessory.prototype.setState = function(state, callback) {

    var isOn = state;

    this.log("Set state to %s", isOn ? "on" : "off");

    if(isOn)
        this.tcService.tcArm(callback);
    else
        this.tcService.tcDisarm(callback);

}

TC2Accessory.prototype.getServices = function() {
    return [this.service];
}