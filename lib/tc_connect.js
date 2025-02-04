const jwt = require('jsonwebtoken');
var request = require("request");
var xmlConverter = require("xml-js");
const JSEncrypt = require('node-jsencrypt');


function findFirstInArray(xmlData, targetField)
{
    var currentTree = xmlData.elements;
    while(currentTree != null) {
        for (var i = 0; i < currentTree.length; i++) {
            var child = currentTree[i];

            if (child.name === targetField) {
                return child.elements[0].text;
            }

            if(child.elements != undefined && child.elements != null){
                var retval = findFirstInArray(child, targetField);
                if(retval != undefined && retval != null)
                    return retval;
            }

        }
        currentTree = currentTree.elements;
    }

    return null;
}

//check the TC result for errors/success
//0 = no error
//1 = re-auth
//2 = error
function tcResultErrorCode(data, callback)
{
    var resultCode = null;
    if(data["ResultCode"] == null)//checking success from SOAP calls
        resultCode = findFirstInArray(data, 'ResultCode');
    else//checking for success for REST calls
        resultCode = data["ResultCode"];

    if(typeof resultCode != "string")
        resultCode = resultCode.toString();

    var error = null;
    if(resultCode === null) {
        error = new Error('unable to retrieve result code');
    }
    else{
        switch (resultCode) {
            case '0':
            case '4500':
                //success

                break;
            case '-102'://this means the session ID is invalid, need to re-auth
                return 1;
            case '4101': //We are unable to connect to the security panel. Please try again later or contact support
            case '4108': //Panel not connected with Virtual Keypad. Check Power/Communication failure
            case '-4002': //The specified location is not valid
            case '-4108': //Cannot establish a connection at this time. Please contact your Security Professional if the problem persists.
            case '-4502': //Command cannot be completed (this happens if you are arming, and it's already armed :shrug:)
            default:
                error = new Error('command error\'ed out from panel with a result of: ' + resultCode);
                break;
        }

    }

    if(error != null) {
        callback(error, false);
        return 2;
    }
    else {
        return 0;
    }
}


function TC_connect(log, config) {
    this.log = log;
    this.config = config;

    this.username = this.config["username"];
    this.password = this.config["password"];
    this.appID = this.config["appID"];
    this.version = this.config["version"];

}

//this call pulls the config from total connect for some auth details (a prereq to any login)
TC_connect.prototype.initTCConfig = function(callback, authenticatedMethod){

    //just in case, we can bail if we already did this
    if(this.tcConfig != null){
        this.tcLogin(callback, authenticatedMethod);
        return;
    }

    //get app params
    request.get({
        url: "https://totalconnect2.com/application.config.json?v=3.41.1.71"
    }, function(err, response, body) {
        
        if (!err && typeof response !== 'undefined' && response.statusCode == 200) {
            var result = JSON.parse(body);
            if(result["AppConfig"] != null || result["AppConfig"].length == 0)
            {
                this.tcConfig = result["AppConfig"][0];
                this.tcLogin(callback, authenticatedMethod);
            }
            else
                this.log("Cannot find AppConfig section");
        }
        else{
            this.log("Unable to get TC Connect app Config (status code %s): %s, %s", typeof response !== 'undefined' ? response.statusCode : "response undefined", err, body);
        }
    }.bind(this));
}




//callback is the method to callback when the full call cycle is completed.
//for any call to request data, there is a call to login, then get details, then the actual call to get the requested data
//may not be necessary to call get details every time. could probably save some cycles and only call once
//will add some logging to test

//2.2.25 - changed authentication to get token for API access (tcLogin gets auth token, then tcGetDetails gets the Session ID)
TC_connect.prototype.tcLogin = function(callback, authenticatedMethod)
{
     var that = this;

    if(that.tcConfig == null)
    {
        this.initTCConfig(callback, authenticatedMethod);
        return;
    }

    //if the session is initialized and within 4 minutes, no need to re-auth
    if(that.sessionDateTime != null && ((that.sessionDateTime + 240000) > Date.now())) {
        that.log('session already initialized');
        that.tcGetDetails(callback, authenticatedMethod, that);
        return;
    }

    const encrypt = new JSEncrypt();
    
    var key = `\r\n-----BEGIN PUBLIC KEY-----\r\n${this.tcConfig["tc2APIKey"]}\r\n-----END PUBLIC KEY-----\r\n`;
    encrypt.setPublicKey(key);

    var userEncrypted = encrypt.encrypt(that.username);
    var passEncrypted = encrypt.encrypt(that.password);

    request.post({
        url: "https://rs.alarmnet.com/TC2API.Auth/token",
        form:{ userName: userEncrypted,
            password: passEncrypted,
            grant_type: "password",
            client_id: this.tcConfig["tc2ClientId"],
            locale: "en-US" }
    }, function(err, response, body) {

        if (!err && typeof response !== 'undefined' && response.statusCode == 200) {


            var result = JSON.parse(body);
            if(result["access_token"] == null) {
                that.log('unable to retrieve access token');
                callback(new Error('unable to retrieve access token'));
            }
            else {
                that.accessToken = result["access_token"];
                that.tokenCreds = jwt.decode(this.accessToken);
                that.sessionToken = this.tokenCreds["ids"].split(';')[0];
                that.sessionDateTime = Date.now();
                that.log('session: ' + that.sessionToken);
                that.tcGetDetails(callback, authenticatedMethod, that);
            }
        }
        else {
            that.log("Error getting session (status code %s): %s, %s", typeof response !== 'undefined' ? response.statusCode : "response undefined", err, body);
            callback(err, body);
        }
    }.bind(this));

}

TC_connect.prototype.tcGetDetails = function(callback, authenticatedMethod, that) {

    request.post({
        url: "https://rs.alarmnet.com/TC21api/tc2.asmx/GetSessionDetails",
        form:{ SessionID: that.sessionToken,
            ApplicationID: that.appID,
            ApplicationVersion: that.version}
    }, function(err, response, body) {

        if (!err && typeof response !== 'undefined' && response.statusCode == 200) {

            var result = JSON.parse(xmlConverter.xml2json(body, {compact: false, spaces: 4}));

            var tcError = tcResultErrorCode(result, callback)
            if(tcError == 1) {
                that.log('re-auth needed from response -102 in auth method...');
                that.tcLogin(callback, authenticatedMethod);
            }
            else if(tcError == 2){
                return;
            }
            else {

                that.log("---- TEST ----");
                that.locationID = findFirstInArray(result, 'LocationID');
                that.log('location: ' + that.locationID);

                if (that.locationID === null) {
                    that.log('unable to get location id');
                    callback(new Error('unable to get location id'), false);
                    return;
                }

                that.deviceID = findFirstInArray(result, 'DeviceID');
                that.log('device: ' + that.deviceID);

                if (that.deviceID === null) {
                    that.log('unable to get device id');
                    callback(new Error('unable to get device id'), false);
                    return;
                }

                authenticatedMethod(callback, that);
            }

        }
        else {
            that.log("Error getting session details (status code %s): %s, %s", typeof response !== 'undefined' ? response.statusCode : "response undefined", err, body);
            callback(err, body);
        }
    }.bind(this));

}

TC_connect.prototype.tcIsArmed = function(callback) {
    //start with login method to validate credentials, and pass off to authenticated method afterwards

    this.tcLogin(callback, this.tcIsArmedAuthenticated);
}

TC_connect.prototype.tcIsArmedAuthenticated = function(callback, that) {
    //call
    that.log("i am authenticated, and getting is armed");

    request.post({
        url: "https://rs.alarmnet.com/TC21api/tc2.asmx/GetPanelMetaDataAndFullStatusEx",
        form:{ SessionID: that.sessionToken,
            LocationID: that.locationID,
            LastSequenceNumber: '0',
            LastUpdatedTimestampTicks: '0',
            PartitionID: '1'}
    }, function(err, response, body) {

        if (!err && typeof response !== 'undefined' && response.statusCode == 200) {

            var result = JSON.parse(xmlConverter.xml2json(body, {compact: false, spaces: 4}));
            var tcError = tcResultErrorCode(result, callback)
            if(tcError == 1) {
                that.log('re-auth needed from response -102 in auth method...');
                that.tcLogin(callback, that.tcIsArmedAuthenticated);
            }
            else if(tcError == 2){
                that.log(`error ${body}`);
                return;
            }
            else {

                var armingState = findFirstInArray(result, 'ArmingState');

                if (armingState === null) {
                    that.log('unable to get arm state');
                    callback(new Error('unable to get arm state'), false);
                    return;
                }

                that.log('arm state: ' + armingState);

                var isArmed = armingState === "10203" || armingState == "10201";

                callback(null, isArmed);
            }

        }
        else {
            that.log("Error getting arm status (status code %s): %s, %s", typeof response !== 'undefined' ? response.statusCode : "response undefined", err, body);
            callback(err, body);
        }
    }.bind(this));

}

TC_connect.prototype.tcArm = function(callback) {
    this.tcLogin(callback, this.tcArmAuthenticated);
}

TC_connect.prototype.tcArmAuthenticated = function(callback, that) {

    that.log("i am authenticated, and arming");

    var putURL = `https://rs.alarmnet.com/TC2API.TCResource/api/v2/locations/${that.locationID}/devices/${that.deviceID}/partitions/arm`;

    request.put({
        url: putURL,
        headers: { Authorization: `Bearer ${that.accessToken}`},
        json:{ armType: '1',
            userCode: '-1'}
    }, function(err, response, body) {

        if (!err && typeof response !== 'undefined' && response.statusCode == 200) {

            var tcError = tcResultErrorCode(body, callback);
            if(tcError == 1) {
                that.log('re-auth needed from response -102 in auth method...');
                that.tcLogin(callback, that.tcArmAuthenticated);
            }
            else if(tcError == 2){
                that.log(`error ${JSON.stringify(body)}`);
                return;
            }
            else {
                that.log('system is now armed');

                callback(null, "armed");
            }
        }
        else {
            that.log("Error arming (status code %s): %s, %s", typeof response !== 'undefined' ? response.statusCode : "response undefined", err, body);
            callback(err, body);
        }
    }.bind(this));
}

TC_connect.prototype.tcDisarm = function(callback) {
    this.tcLogin(callback, this.tcDisarmAuthenticated);
}

TC_connect.prototype.tcDisarmAuthenticated = function(callback, that) {

    that.log("i am authenticated, and disarming");

    var putURL = `https://rs.alarmnet.com/TC2API.TCResource/api/v2/locations/${that.locationID}/devices/${that.deviceID}/partitions/disarm`;

    request.put({
        url: putURL,
        headers: { Authorization: `Bearer ${that.accessToken}`},
        json:{ armType: '-1',
            userCode: '-1'}
    }, function(err, response, body) {

        if (!err && typeof response !== 'undefined' && response.statusCode == 200) {

            var tcError = tcResultErrorCode(body, callback);
            if(tcError == 1) {
                that.log('re-auth needed from response -102 in auth method...');
                that.tcLogin(callback, that.tcArmAuthenticated);
                return;
            }
            else if(tcError == 2){
                that.log(`error ${JSON.stringify(body)}`);
                return;
            }
            else {
                that.log('system is now disarmed');

                callback(null, "disarmed");
            }
        }
        else {
            that.log("Error disarming (status code %s): %s, %s", typeof response !== 'undefined' ? response.statusCode : "response undefined", err, body);
            callback(err, body);
        }
    }.bind(this));
}

module.exports = TC_connect;