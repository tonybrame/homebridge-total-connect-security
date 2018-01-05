var request = require("request");
var xml = require("xml-parse");

/*
{
        "accessory": "TotalConnectSecurity",
        "name": "Security System",
        "username": "tbrame1",
        "password": "xxx",
        "appID": "14588",
        "version": "1.0.0"
   }
*/

function findFirstInArray(xmlData, targetField)
{
    var currentTree = xmlData;
    while(currentTree != null) {
        for (var i = 0; i < currentTree.length; i++) {
            var child = currentTree[i];
            if(child.childNodes != undefined && child.childNodes != null){
                var retval = findFirstInArray(child.childNodes, targetField);
                if(retval != undefined && retval != null)
                    return retval;
            }
            if (child.tagName === targetField) {
                return child.innerXML;
            }

        }
        currentTree = currentTree.childNodes;
    }

    return null;
}

//check the TC result for errors/success
//0 = no error
//1 = re-auth
//2 = error
function tcResultErrorCode(data, callback)
{
    var resultCode = findFirstInArray(data, 'ResultCode');
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

//callback is the method to callback when the full call cycle is completed.
//for any call to request data, there is a call to login, then get details, then the actual call to get the requested data
//may not be necessary to call get details every time. could probably save some cycles and only call once
//will add some logging to test
TC_connect.prototype.tcLogin = function(callback, authenticatedMethod)
{
     var that = this;

    //if the session is initialized and within 4 minutes, no need to re-auth
    if(that.sessionDateTime != null && ((that.sessionDateTime + 240000) > Date.now())) {
        that.log('session already initialized');
        that.tcGetDetails(callback, authenticatedMethod, that);
        return;
    }

    request.post({
        url: "https://rs.alarmnet.com/TC21api/tc2.asmx/AuthenticateUserLogin",
        form:{ userName: that.username,
            password: that.password,
            ApplicationID: that.appID,
            ApplicationVersion: that.version}
    }, function(err, response, body) {

        if (!err && response.statusCode == 200) {


            var result = xml.parse(body);

            var tcError = tcResultErrorCode(result, callback)
            if(tcError == 1) {
                that.log('re-auth needed from response -102 in auth method, failing.');
                callback(new Error('re-auth needed from response -102 in auth method, failing.'));
            }
            else if(tcError == 2){
                return;
            }
            else {

                var sessionID = findFirstInArray(result, 'SessionID');
                if (sessionID != null) {
                    that.sessionToken = sessionID;
                    that.sessionDateTime = Date.now();
                    that.log('session: ' + that.sessionToken);

                    that.tcGetDetails(callback, authenticatedMethod, that);
                }
                else {
                    that.log('unable to get session');
                    callback(new Error('unable to get session'), false);
                }
            }

        }
        else {
            that.log("Error getting session (status code %s): %s, %s", response.statusCode, err, body);
            callback(err);
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

        if (!err && response.statusCode == 200) {

            var result = xml.parse(body);

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
            that.log("Error getting location details (status code %s): %s, %s", response.statusCode, err, body);
            callback(err);
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

        if (!err && response.statusCode == 200) {

            var result = xml.parse(body);
            var tcError = tcResultErrorCode(result, callback)
            if(tcError == 1) {
                that.log('re-auth needed from response -102 in auth method...');
                that.tcLogin(callback, that.tcIsArmedAuthenticated);
            }
            else if(tcError == 2){
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
            that.log("Error getting arm state (status code %s): %s, %s", response.statusCode, err, body);
            callback(err);
        }
    }.bind(this));

}

TC_connect.prototype.tcArm = function(callback) {
    this.tcLogin(callback, this.tcArmAuthenticated);
}

TC_connect.prototype.tcArmAuthenticated = function(callback, that) {

    that.log("i am authenticated, and arming");

    request.post({
        url: "https://rs.alarmnet.com/TC21api/tc2.asmx/ArmSecuritySystem",
        form:{ SessionID: that.sessionToken,
            LocationID: that.locationID,
            DeviceID: that.deviceID,
            ArmType: '1',
            UserCode: '-1'}
    }, function(err, response, body) {

        if (!err && response.statusCode == 200) {

            that.log(body);

            var result = xml.parse(body);

            that.log('I hope it\'s armed now');

            callback(null, "armed");
        }
        else {
            that.log("Error arming (status code %s): %s, %s", response.statusCode, err, body);
            callback(err);
        }
    }.bind(this));
}

TC_connect.prototype.tcDisarm = function(callback) {
    this.tcLogin(callback, this.tcDisarmAuthenticated);
}

TC_connect.prototype.tcDisarmAuthenticated = function(callback, that) {

    that.log("i am authenticated, and disarming");

    request.post({
        url: "https://rs.alarmnet.com/TC21api/tc2.asmx/DisarmSecuritySystem",
        form:{ SessionID: that.sessionToken,
            LocationID: that.locationID,
            DeviceID: that.deviceID,
            UserCode: '-1'}
    }, function(err, response, body) {

        if (!err && response.statusCode == 200) {

            that.log(body);

            var result = xml.parse(body);

            that.log('I hope it\'s disarmed now');

            callback(null, "disarmed");
        }
        else {
            that.log("Error disarming (status code %s): %s, %s", response.statusCode, err, body);
            callback(err);
        }
    }.bind(this));
}

module.exports = TC_connect;