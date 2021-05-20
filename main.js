"use strict";

/*
 * Created with @iobroker/create-adapter v1.18.0
 */
const utils = require("@iobroker/adapter-core");
// const http = require("https");
const { http, https } = require('follow-redirects');
const fs = require('fs');
const libxmljs = require('libxmljs2');
var path = require('path');
var xml;
var xmlDoc;
var timeout;

const datesAreOnSameDay = (first, second) =>
	first.getFullYear() === second.getFullYear() &&
	first.getMonth() === second.getMonth() &&
	first.getDate() === second.getDate();

function getActualDateFormattet(actualDate) {
	var	year = (actualDate.getFullYear());
	var month = (actualDate.getMonth()<10?'0':'') + actualDate.getMonth();
	var day = (actualDate.getDate()<10?'0':'') + actualDate.getDate();
	return year + "-" + month + "-" + day;
}

function getTimeFormattet(actualDate) {
	var	hour = (actualDate.getHours()<10?'0':'') + actualDate.getHours();
	var min = (actualDate.getMinutes()<10?'0':'') + actualDate.getMinutes();
	var sec = (actualDate.getSeconds()<10?'0':'') + actualDate.getSeconds();
	return hour + ":" + min + ":" + sec;
}

Date.prototype.addDays = function(days) {
	var date = new Date(this.valueOf());
	date.setDate(date.getDate() + days);
	return date;
}

class SwissWeatherApi extends utils.Adapter {
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		// @ts-ignore
		super({
			...options,
			name: "swiss-weather-api",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		getSystemData(this); // read Longitude und Latitude
		setTimeout(doIt, 10000, this); // First start after 10s
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.log.debug("cleaned everything up...");
			clearTimeout(timeout);
			callback();
		} catch (e) {
			callback();
		}
	}
}

/**
 * Get longitude/latitude from system if not set or not valid
 * do not change if we have already a valid value
 * so we could use different settings compared to system if necessary
 * @param self Adapter
 */
function getSystemData(self) {
	if (typeof self.config.Longitude == undefined || self.config.Longitude == null || self.config.Longitude.length == 0 || isNaN(self.config.Longitude)
		|| typeof self.config.Latitude == undefined || self.config.Latitude == null || self.config.Latitude.length == 0 || isNaN(self.config.Latitude)) {
		self.log.info("longitude/longitude not set, get data from system ");
		self.getForeignObject("system.config", (err, state) => {
			if (err || state === undefined || state === null) {
				self.log.error("longitude/latitude not set in adapter-config and reading in system-config failed");
			} else {
				self.config.Longitude = state.common.longitude;
				self.config.Latitude = state.common.latitude;
				self.log.info("system  longitude: " + self.config.Longitude + " latitude: " + self.config.Latitude);
			}
		});
	} else {
		self.log.info("longitude/longitude will be set by self-Config - longitude: " + self.config.Longitude + " latitude: " + self.config.Latitude);
	}
}

function doIt(self) {
	// First get Access Token
	var access_token;
	//Convert ConsumerKey and ConsumerSecret to base64
	let data = self.config.ConsumerKey + ":" + self.config.ConsumerSecret;
	var pollInterval = self.config.PollInterval * 60000; //Convert minute to miliseconds
	let buff = Buffer.from(data);
	let base64data = buff.toString('base64');
	self.log.debug('"' + data + '" converted to Base64 is "' + base64data + '"');
	var today = new Date();
	var today1 = new Date().addDays(1);
	var today2 = new Date().addDays(2);
	var today3 = new Date().addDays(3);
	var today4 = new Date().addDays(4);
	var today5 = new Date().addDays(5);

	//Options for getting Access-Token
	var options_Access_Token = {
		"json": true,
		"method": "POST",
		"hostname": "api.srgssr.ch",
		"port": null,
		"path": "/oauth/v1/accesstoken?grant_type=client_credentials",
		"headers": {
			"Authorization": "Basic " + base64data,
			"Cache-Control": "no-cache",
			"Content-Length": 0,
			"Postman-Token": "24264e32-2de0-f1e3-f3f8-eab014bb6d76"
		}
	};

	self.log.debug("Options to get Access Token: " + JSON.stringify(options_Access_Token));

	var req = https.request(options_Access_Token, function (res) {
		var chunks = [];
		res.on("data", function (chunk) {
			chunks.push(chunk);
		});
		res.on("end", function () {
			self.log.debug("Answer of Request Access Token: " + Buffer.concat(chunks).toString());
			var body = JSON.parse(Buffer.concat(chunks).toString());
			if (body.access_token === undefined) {
				self.log.warn("Got no Token - Is Adapter correctly configured (ConsumerKey/ConsumerSecret)? It may also be that the maximum number of queries for today is exhausted");
				return;
			} else if (body.access_token == ""){
				self.log.warn("Got an empty Token - It may be that the maximum number of queries for today is exhausted");
				return;
			}
			access_token = body.access_token.toString();
			self.log.debug("Access_Token : " + access_token);

			//Now get GeolocationId
			//Options for getting current Geolocation id
			var options_geolocationId = {
				"method": "GET",
				"hostname": "api.srgssr.ch",
				"port": null,
				"path": "/srf-meteo/geolocations?latitude=" + self.config.Latitude + "&longitude=" + self.config.Longitude,
				"headers": {
					"authorization": "Bearer " + access_token
				}
			};

			self.log.debug("Options to get GeolocationId: " + JSON.stringify(options_geolocationId));

			//set request
			var req = https.request(options_geolocationId, function (res) {
				var chunks = [];
				res.on("data", function (chunk) {
					chunks.push(chunk);
				});
				res.on("end", function () {
					self.log.debug("Answer of getGeolocation Request: " + Buffer.concat(chunks).toString());
					var body = JSON.parse(Buffer.concat(chunks).toString());
					self.log.debug("Body: " + JSON.stringify(body));

					//check if there is a Error-Code
					if (body.hasOwnProperty("code")) {
						self.log.debug("Return Code: " + body.code.toString());
						if (body.code.toString().startsWith("404")) {
							self.log.error("Get Gelocation id - Resource not found");
							return;
						} else if (body.code.toString().startsWith("400")){
							self.log.error("Get Gelocation id -  Invalid request");
							self.log.error("Get Gelocation id  - An error has occured. " + JSON.stringify(body));
							return;
						} else if (body.code.toString().startsWith("401")){
							self.log.error("Get Gelocation id -  Invalid or expired access token ");
							self.log.error("Get Gelocation id  - An error has occured. " + JSON.stringify(body));
							return;
						} else if (body.code.toString().startsWith("429")) {
							self.log.error("Get Gelocation id -  Invalid or expired access token ");
							self.log.error("Get Gelocation id  - An error has occured. " + JSON.stringify(body));
							return;
						} else {
							self.log.error("Get Gelocation id - An error has occured. " + JSON.stringify(body));
							return;
						}
					}

					//Extract GeolocationID
					var geolocationId = body[0].id.toString();

					//Now get forecast
					//Options for getting forecast
					var options_forecast = {
						"method": "GET",
						"hostname": "api.srgssr.ch",
						"port": null,
						"path": "/srf-meteo/forecast/"+geolocationId,
						"headers": {
							"authorization": "Bearer " + access_token
						}
					};

					self.log.debug("Options to get forecast: " + JSON.stringify(options_forecast))

					//set request
					var req = https.request(options_forecast, function (res) {
						var chunks = [];
						res.on("data", function (chunk) {
							chunks.push(chunk);
						});
						res.on("end", function () {
							self.log.debug("Answer of forecast Request: " + Buffer.concat(chunks).toString());
							var body = JSON.parse(Buffer.concat(chunks).toString());
							self.log.debug("Body: " + JSON.stringify(body));

							//check if there is a Error-Code
							if (body.hasOwnProperty("code")) {
								self.log.debug("Return Code: " + body.code.toString());
								if (body.code.toString().startsWith("404")) {
									self.log.error("Forecast - Resource not found");
									return;
								} else if (body.code.toString().startsWith("400")){
									self.log.error("Forecast -  Invalid request");
									self.log.error("Forecast  - An error has occured. " + JSON.stringify(body));
									return;
								} else if (body.code.toString().startsWith("401")){
									self.log.error("Forecast -  Invalid or expired access token ");
									self.log.error("Forecast  - An error has occured. " + JSON.stringify(body));
									return;
								} else if (body.code.toString().startsWith("429")) {
									self.log.error("Forecast -  Invalid or expired access token ");
									self.log.error("Forecast  - An error has occured. " + JSON.stringify(body));
									return;
								} else {
									self.log.error("Forecast - An error has occured. " + JSON.stringify(body));
									return;
								}
							}

							//**************************************
							//*** Start extract forcast informations
							//**************************************

							//*** geolocation informations ***
							self.setObjectNotExists("geolocation." + "id", {
								type: "state",
								common: {
									name: "id",
									type: "string",
									role: "text"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "id", {
									val: body.geolocation.id.toString(),
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "lat", {
								type: "state",
								common: {
									name: "latitude",
									type: "number",
									role: "value.gps.latitude",
									write: false
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "lat", {
									val: body.geolocation.lat,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "lon", {
								type: "state",
								common: {
									name: "longitude",
									type: "number",
									role: "value.gps.longitude",
									write: false
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "lon", {
									val: body.geolocation.lon,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "station_id", {
								type: "state",
								common: {
									name: "station id",
									type: "string",
									role: "text",
									write: false
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "station_id", {
									val: body.geolocation.station_id,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "timezone", {
								type: "state",
								common: {
									name: "timezone",
									type: "string",
									role: "text",
									write: false
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "timezone", {
									val: body.geolocation.timezone,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "default_name", {
								type: "state",
								common: {
									name: "default name",
									type: "string",
									role: "text",
									write: false
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "default_name", {
									val: body.geolocation.default_name,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "alarm_region_id", {
								type: "state",
								common: {
									name: "alarm region id",
									type: "string",
									role: "text",
									write: false
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "alarm_region_id", {
									val: body.geolocation.alarm_region_id,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "alarm_region_name", {
								type: "state",
								common: {
									name: "alarm region name",
									type: "string",
									role: "text",
									write: false
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "alarm_region_name", {
									val: body.geolocation.alarm_region_name,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "district", {
								type: "state",
								common: {
									name: "district",
									type: "string",
									role: "text",
									write: false
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "district", {
									val: body.geolocation.district,
									ack: true
								});
							});

							//Geolocation_Names
							self.setObjectNotExists("geolocation." + "geolocation_names." + "district", {
								type: "state",
								common: {
									name: "district",
									type: "string",
									role: "location"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "district", {
									val: body.geolocation.geolocation_names[0].district,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "id", {
								type: "state",
								common: {
									name: "id",
									type: "string",
									role: "text"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "id", {
									val: body.geolocation.geolocation_names[0].id,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "type", {
								type: "state",
								common: {
									name: "City or POI (Point of Interest)",
									type: "string",
									role: "text"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "type", {
									val: body.geolocation.geolocation_names[0].type,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "language", {
								type: "state",
								common: {
									name: "language",
									type: "number",
									role: "value"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "language", {
									val: body.geolocation.geolocation_names[0].language,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "translation_type", {
								type: "state",
								common: {
									name: "translation type",
									type: "string",
									role: "text"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "translation_type", {
									val: body.geolocation.geolocation_names[0].translation_type,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "name", {
								type: "state",
								common: {
									name: "name",
									type: "string",
									role: "text"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "name", {
									val: body.geolocation.geolocation_names[0].name,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "country", {
								type: "state",
								common: {
									name: "country",
									type: "string",
									role: "text"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "country", {
									val: body.geolocation.geolocation_names[0].country,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "province", {
								type: "state",
								common: {
									name: "province",
									type: "string",
									role: "text"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "province", {
									val: body.geolocation.geolocation_names[0].province,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "inhabitants", {
								type: "state",
								common: {
									name: "inhabitants",
									type: "number",
									role: "value"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "inhabitants", {
									val: body.geolocation.geolocation_names[0].inhabitants,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "height", {
								type: "state",
								common: {
									name: "height",
									type: "number",
									role: "value"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "height", {
									val: body.geolocation.geolocation_names[0].height,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "plz", {
								type: "state",
								common: {
									name: "plz",
									type: "number",
									role: "value"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "plz", {
									val: body.geolocation.geolocation_names[0].plz,
									ack: true
								});
							});
							self.setObjectNotExists("geolocation." + "geolocation_names." + "ch", {
								type: "state",
								common: {
									name: "ch",
									type: "number",
									role: "value"
								},
								native: {},
							}, function () {
								self.setState("geolocation." + "geolocation_names." + "ch", {
									val: body.geolocation.geolocation_names[0].ch,
									ack: true
								});
							});

							//*** Create 60minutes forecast ***
							self.setObjectNotExists("forecast." + "60minutes", {
								type: "channel",
								common: {
									name: "Forecast data for time windows of 60 minutes (for 98 hours from today 0:00)",
									role: "info"
								},
								native: {},
							});
							// Day 0
							self.setObjectNotExists("forecast." + "60minutes.day0", {
								type: "channel",
								common: {
									name: "Forecast data for today",
									role: "info"
								},
								native: {},
							});
							// Day 1
							self.setObjectNotExists("forecast." + "60minutes.day1", {
								type: "channel",
								common: {
									name: "Forecast data for tomorrow",
									role: "info"
								},
								native: {},
							});
							// Day 2
							self.setObjectNotExists("forecast." + "60minutes.day2", {
								type: "channel",
								common: {
									name: "Forecast data for today + 2 days",
									role: "info"
								},
								native: {},
							});
							// Day 3
							self.setObjectNotExists("forecast." + "60minutes.day3", {
								type: "channel",
								common: {
									name: "Forecast data for today + 3 days",
									role: "info"
								},
								native: {},
							});
							// Day 4
							self.setObjectNotExists("forecast." + "60minutes.day4", {
								type: "channel",
								common: {
									name: "Forecast data for today + 4 days",
									role: "info"
								},
								native: {},
							});


							//iterate over all 60minutes objects
							body.forecast["60minutes"].forEach(function(obj,index) {
								var startTimeISOString = obj.local_date_time;
								var objDate = new Date(startTimeISOString);
								var myPath;
								var myTime =  getTimeFormattet(objDate);

								self.log.debug("Compare today " + today + " with objDate " +  objDate);
								self.log.debug("Compare today1 " + today1 + " with objDate " +  objDate);
								self.log.debug("Compare today2 " + today2 + " with objDate " +  objDate);
								self.log.debug("Compare today3 " + today3 + " with objDate " +  objDate);
								self.log.debug("Compare today4 " + today4 + " with objDate " +  objDate);
								self.log.debug("Compare today5 " + today5 + " with objDate " +  objDate);
								if (datesAreOnSameDay(today, objDate)) {
									myPath = "day0";
								} else if (datesAreOnSameDay(today1, objDate)) {
									myPath = "day1";
								} else if (datesAreOnSameDay(today2, objDate)) {
									myPath = "day2";
								} else if (datesAreOnSameDay(today3, objDate)) {
									myPath = "day3";
								} else if (datesAreOnSameDay(today4, objDate)) {
									myPath = "day4";
								} else if (datesAreOnSameDay(today5, objDate)) {
									myPath = "day5";
								} else {
									self.log.error("invalid date found. Could not assign date. The date received is not one of the coming week. " + startTimeISOString);
									return;
								}

								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "local_date_time", {
									type: "state",
									common: {
										name: "Date for validity of record",
										type: "string",
										role: "text",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "local_date_time", {
										val: obj.local_date_time,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "TTT_C", {
									type: "state",
									common: {
										name: "Current temperature in °C",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "TTT_C", {
										val: obj.TTT_C,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "TTL_C", {
									type: "state",
									common: {
										name: "Error range lower limit",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "TTL_C", {
										val: obj.TTL_C,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "TTH_C", {
									type: "state",
									common: {
										name: "Error range upper limit",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "TTH_C", {
										val: obj.TTH_C,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "PROBPCP_PERCENT", {
									type: "state",
									common: {
										name: "Probability of precipitation in %",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "PROBPCP_PERCENT", {
										val: obj.PROBPCP_PERCENT,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "RRR_MM", {
									type: "state",
									common: {
										name: "Precipitation total",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "RRR_MM", {
										val: obj.RRR_MM,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "FF_KMH", {
									type: "state",
									common: {
										name: "Wind speed in km/h",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "FF_KMH", {
										val: obj.FF_KMH,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "FX_KMH", {
									type: "state",
									common: {
										name: "Peak wind speed in km/h",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "FX_KMH", {
										val: obj.FX_KMH,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "DD_DEG", {
									type: "state",
									common: {
										name: "Wind direction in angular degrees: 0 = North wind",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "DD_DEG", {
										val: obj.DD_DEG,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "SYMBOL_CODE", {
									type: "state",
									common: {
										name: "Mapping to weather icon",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "SYMBOL_CODE", {
										val: obj.SYMBOL_CODE,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "ICON_URL_COLOR", {
									type: "state",
									common: {
										name: "URL to color Icon",
										type: "string",
										role: "weather.icon"
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "ICON_URL_COLOR", {
										val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/Meteo_API_Icons/Color/" + obj.SYMBOL_CODE + ".png",
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "ICON_URL_DARK", {
									type: "state",
									common: {
										name: "URL to dark Icon",
										type: "string",
										role: "weather.icon"
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "ICON_URL_DARK", {
										val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/Meteo_API_Icons/Dark/" + obj.SYMBOL_CODE + ".png",
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "ICON_URL_LIGHT", {
									type: "state",
									common: {
										name: "URL to light Icon",
										type: "string",
										role: "weather.icon"
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "ICON_URL_LIGHT", {
										val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/Meteo_API_Icons/Light/" + obj.SYMBOL_CODE + ".png",
										ack: true
									});
								});

								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "type", {
									type: "state",
									common: {
										name: "result set; possible values: 60minutes, hour, day",
										type: "string",
										role: "text",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "type", {
										val: obj.type,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "cur_color", {
									type: "channel",
									common: {
										name: "Mapping temperature / color value",
										role: "info"
									},
									native: {},
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "cur_color." + "temperature", {
									type: "state",
									common: {
										name: "Temperature value",
										type: "number",
										role: "value",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "cur_color." + "temperature", {
										val: obj.cur_color.temperature,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "cur_color." + "background_color", {
									type: "state",
									common: {
										name: "background hex color value",
										type: "string",
										role: "text",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "cur_color." + "background_color", {
										val: obj.cur_color.background_color,
										ack: true
									});
								});
								self.setObjectNotExists("forecast." + "60minutes." + myPath +"." + myTime +"." + "cur_color." + "text_color", {
									type: "state",
									common: {
										name: "text hex color value",
										type: "string",
										role: "text",
										write: false
									},
									native: {},
								}, function () {
									self.setState("forecast." + "60minutes." + myPath +"." + myTime +"." + "cur_color." + "text_color", {
										val: obj.cur_color.text_color,
										ack: true
									});
								});
							});

							//*** Create day forecast ***
							// self.setObjectNotExists("forecast." + "day", {
							// 	type: "channel",
							// 	common: {
							// 		name: "Forecast data for a whole day (for 8 days from today 0:00 )",
							// 		role: "info"
							// 	},
							// 	native: {},
							// });

							//iterate over all day objects
							// body.forecast["day"].forEach(function(obj,index) {
							// 	var index_formattet = (index).toLocaleString(undefined, {minimumIntegerDigits: 2});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "local_date_time", {
							// 		type: "state",
							// 		common: {
							// 			name: "Date for validity of record",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "local_date_time", {
							// 			val: obj.local_date_time,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "TX_C", {
							// 		type: "state",
							// 		common: {
							// 			name: "Maximum temperature in °C",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "TX_C", {
							// 			val: obj.TX_C,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "TN_C", {
							// 		type: "state",
							// 		common: {
							// 			name: "Lowest temperature in °C",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "TN_C", {
							// 			val: obj.TN_C,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "PROBPCP_PERCENT", {
							// 		type: "state",
							// 		common: {
							// 			name: "Probability of precipitation in %",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "PROBPCP_PERCENT", {
							// 			val: obj.PROBPCP_PERCENT,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "RRR_MM", {
							// 		type: "state",
							// 		common: {
							// 			name: "Precipitation total",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "RRR_MM", {
							// 			val: obj.RRR_MM,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "FF_KMH", {
							// 		type: "state",
							// 		common: {
							// 			name: "Wind speed in km/h",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "FF_KMH", {
							// 			val: obj.FF_KMH,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "FX_KMH", {
							// 		type: "state",
							// 		common: {
							// 			name: "Peak wind speed in km/h",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "FX_KMH", {
							// 			val: obj.FX_KMH,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "DD_DEG", {
							// 		type: "state",
							// 		common: {
							// 			name: "Wind direction in angular degrees: 0 = North wind",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "DD_DEG", {
							// 			val: obj.DD_DEG,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "SUNSET", {
							// 		type: "state",
							// 		common: {
							// 			name: "Time sunset",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "SUNSET", {
							// 			val: obj.SUNSET,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "SUNRISE", {
							// 		type: "state",
							// 		common: {
							// 			name: "Time sunrise",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "SUNRISE", {
							// 			val: obj.SUNRISE,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "SUN_H", {
							// 		type: "state",
							// 		common: {
							// 			name: "Sun hours",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "SUN_H", {
							// 			val: obj.SUN_H,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "SYMBOL_CODE", {
							// 		type: "state",
							// 		common: {
							// 			name: "Mapping to weather icon",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "SYMBOL_CODE", {
							// 			val: obj.SYMBOL_CODE,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "type", {
							// 		type: "state",
							// 		common: {
							// 			name: "result set; possible values: 60minutes, hour, day",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "type", {
							// 			val: obj.type,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "min_color", {
							// 		type: "channel",
							// 		common: {
							// 			name: "Mapping temperature / color value",
							// 			role: "info"
							// 		},
							// 		native: {},
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "min_color." + "temperature", {
							// 		type: "state",
							// 		common: {
							// 			name: "temperature",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "min_color." + "temperature", {
							// 			val: obj.min_color.temperature,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "min_color." + "background_color", {
							// 		type: "state",
							// 		common: {
							// 			name: "background color",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "min_color." + "background_color", {
							// 			val: obj.min_color.background_color,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "min_color." + "text_color", {
							// 		type: "state",
							// 		common: {
							// 			name: "text color",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "min_color." + "text_color", {
							// 			val: obj.min_color.text_color,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "max_color", {
							// 		type: "channel",
							// 		common: {
							// 			name: "Mapping temperature / color value",
							// 			role: "info"
							// 		},
							// 		native: {},
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "max_color." + "temperature", {
							// 		type: "state",
							// 		common: {
							// 			name: "temperature",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "max_color." + "temperature", {
							// 			val: obj.max_color.temperature,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "max_color." + "background_color", {
							// 		type: "state",
							// 		common: {
							// 			name: "background color",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "max_color." + "background_color", {
							// 			val: obj.max_color.background_color,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "day.item_" + index_formattet +"." + "max_color." + "text_color", {
							// 		type: "state",
							// 		common: {
							// 			name: "text color",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "day.item_" + index_formattet +"." + "max_color." + "text_color", {
							// 			val: obj.max_color.text_color,
							// 			ack: true
							// 		});
							// 	});
							// });

							//*** Create hour forecast ***
							// self.setObjectNotExists("forecast." + "hour", {
							// 	type: "channel",
							// 	common: {
							// 		name: "forecast data for a time window of 3 hours (for 8 days from today 2:00 )",
							// 		role: "info"
							// 	},
							// 	native: {},
							// });

							//iterate over all hour objects
							// body.forecast["hour"].forEach(function(obj,index) {
							// 	var index_formattet = (index).toLocaleString(undefined, {minimumIntegerDigits: 2});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "local_date_time", {
							// 		type: "state",
							// 		common: {
							// 			name: "Date for validity of record",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "local_date_time", {
							// 			val: obj.local_date_time,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "TTT_C", {
							// 		type: "state",
							// 		common: {
							// 			name: "Current temperature in °C",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "TTT_C", {
							// 			val: obj.TTT_C,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "TTL_C", {
							// 		type: "state",
							// 		common: {
							// 			name: "Error range lower limit",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "TTL_C", {
							// 			val: obj.TTL_C,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "TTH_C", {
							// 		type: "state",
							// 		common: {
							// 			name: "Error range upper limit",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "TTH_C", {
							// 			val: obj.TTH_C,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "PROBPCP_PERCENT", {
							// 		type: "state",
							// 		common: {
							// 			name: "Probability of precipitation in %",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "PROBPCP_PERCENT", {
							// 			val: obj.PROBPCP_PERCENT,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "RRR_MM", {
							// 		type: "state",
							// 		common: {
							// 			name: "Precipitation total",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "RRR_MM", {
							// 			val: obj.RRR_MM,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "FF_KMH", {
							// 		type: "state",
							// 		common: {
							// 			name: "Wind speed in km/h",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "FF_KMH", {
							// 			val: obj.FF_KMH,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "FX_KMH", {
							// 		type: "state",
							// 		common: {
							// 			name: "Peak wind speed in km/h",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "FX_KMH", {
							// 			val: obj.FX_KMH,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "DD_DEG", {
							// 		type: "state",
							// 		common: {
							// 			name: "Wind direction in angular degrees: 0 = North wind",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "DD_DEG", {
							// 			val: obj.DD_DEG,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "SYMBOL_CODE", {
							// 		type: "state",
							// 		common: {
							// 			name: "Mapping to weather icon",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "SYMBOL_CODE", {
							// 			val: obj.SYMBOL_CODE,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "type", {
							// 		type: "state",
							// 		common: {
							// 			name: "result set; possible values: 60minutes, hour, day",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "type", {
							// 			val: obj.type,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "cur_color", {
							// 		type: "channel",
							// 		common: {
							// 			name: "Mapping temperature / color value",
							// 			role: "info"
							// 		},
							// 		native: {},
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "cur_color." + "temperature", {
							// 		type: "state",
							// 		common: {
							// 			name: "Temperature value",
							// 			type: "number",
							// 			role: "value",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "cur_color." + "temperature", {
							// 			val: obj.cur_color.temperature,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "cur_color." + "background_color", {
							// 		type: "state",
							// 		common: {
							// 			name: "background hex color value",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "cur_color." + "background_color", {
							// 			val: obj.cur_color.background_color,
							// 			ack: true
							// 		});
							// 	});
							// 	self.setObjectNotExists("forecast." + "hour.item_" + index_formattet +"." + "cur_color." + "text_color", {
							// 		type: "state",
							// 		common: {
							// 			name: "text hex color value",
							// 			type: "string",
							// 			role: "text",
							// 			write: false
							// 		},
							// 		native: {},
							// 	}, function () {
							// 		self.setState("forecast." + "hour.item_" + index_formattet +"." + "cur_color." + "text_color", {
							// 			val: obj.cur_color.text_color,
							// 			ack: true
							// 		});
							// 	});
							// });
						});
						res.on("error", function (error) {
							self.log.error(error)
						});
					});
					req.end();
				});
				res.on("error", function (error) {
					self.log.error(error)
				});
			});
			req.end();
		});
		res.on("error", function (error) {
			self.log.error(error)
		});
	});
	req.end();
	setTimeout(doIt, pollInterval, self);
}

// var doIt = function(self) {
// 	self.log.info("Swiss-Weather-API: Get Weather Infos...");
//
// 	var appName = self.config.App_Name;
// 	var latitude = self.config.Latitude;
// 	var longitude = self.config.Longitude;
// 	var consumerKey = self.config.ConsumerKey;
// 	var consumerSecret = self.config.ConsumerSecret;
// 	var pollInterval = self.config.PollInterval * 60000; //Convert minute to miliseconds
//
// 	var icon = "";
//
// 	//Mandantory Attributes
// 	if (latitude === undefined) {
// 		self.log.warn("Got no latitude - Is adapter correctly configured (latitude)?;");
// 		return;
// 	} else if (longitude === undefined) {
// 		self.log.warn("Got no longitude - Is adapter correctly configured (longitude)?;");
// 		return;
// 	} else if (consumerKey === undefined) {
// 		self.log.warn("Got no consumerKey - Is adapter correctly configured (consumerKey)?;");
// 		return;
// 	} else if (consumerSecret === undefined) {
// 		self.log.warn("Got no consumerSecret - Is adapter correctly configured (consumerSecret)?;");
// 		return;
// 	} else if (pollInterval === undefined) {
// 		self.log.warn("Got no pollInterval - Is adapter correctly configured (pollInterval)?;");
// 		return;
// 	}
//
// 	self.log.debug("App Name: " + appName);
// 	self.log.debug("Consumer Key: " + consumerKey);
// 	self.log.debug("Consumer Secret: " + consumerSecret);
// 	self.log.debug("Latitude " + latitude);
// 	self.log.debug("Longitude: " + longitude);
// 	self.log.debug("Poll Interval: " + pollInterval);
//
// 	//Prepare XML File in order to get the weather-icon
// 	self.log.debug("Define XML File:...");
// 	try {
// 		xml = fs.readFileSync(path.join(__dirname, 'img', 'weather-icons', 'SRG-SSR-WeatherAPITranslations.xml'));
// 		xmlDoc = libxmljs.parseXmlString(xml);
// 	} catch (err) {
// 		self.log.error("An error has occured while trying to read SRG-SSR-WeatherAPITranslations.xml. Please create an Issue on Github Project-Site. Error Code is: " + err.code);
// 		return;
// 	}
//
// 	//Convert ConsumerKey and ConsumerSecret to base64
// 	let data = consumerKey + ":" + consumerSecret;
// 	let buff = Buffer.from(data);
// 	let base64data = buff.toString('base64');
// 	self.log.debug('"' + data + '" converted to Base64 is "' + base64data + '"');
//
// 	//Options for getting Access-Token
// 	var options_Access_Token = {
// 		"json": true,
// 		"method": "POST",
// 		"hostname": "api.srgssr.ch",
// 		"port": null,
// 		"path": "/oauth/v1/accesstoken?grant_type=client_credentials",
// 		"headers": {
// 			"Authorization": "Basic " + base64data,
// 			"Cache-Control": "no-cache",
// 			"Content-Length": 0,
// 			"Postman-Token": "24264e32-2de0-f1e3-f3f8-eab014bb6d76"
// 		}
// 	};
//
// 	/**
// 	 * First get Access_Token, afterwards get forcast-informations for
// 	 * - current forecast
// 	 * - week forecast
// 	 * - next hour forecast
// 	 * - 24 hour forecast
// 	 */
// 	var req = http.request(options_Access_Token, function (res) {
// 		var chunks = [];
// 		res.on("data", function (chunk) {
// 			chunks.push(chunk);
// 		});
// 		res.on("end", function () {
// 			var body = JSON.parse(Buffer.concat(chunks).toString());
// 			if (body.access_token === undefined) {
// 				self.log.warn("Got no Token - Is Adapter correctly configured (ConsumerKey/ConsumerSecret)?;");
// 				return;
// 			}
// 			access_token = body.access_token.toString();
// 			self.log.debug("Access_Token : " + access_token);
//
// 			//********************************************************************************************
// 			//* Read Current Forcast
// 			//********************************************************************************************
//
// 			//Options for getting current Forecast using Authorization Bearer
// 			var options_current_forecast = {
// 				"method": "GET",
// 				"hostname": "api.srgssr.ch",
// 				"port": null,
// 				"path": "/forecasts/v1.0/weather/current?latitude=" + latitude + "&longitude=" + longitude,
// 				"headers": {
// 					"authorization": "Bearer " + access_token
// 				}
// 			};
//
// 			var reqCurrentForecast = http.request(options_current_forecast, function (res) {
// 				var chunks = [];
// 				res.on("data", function (chunk) {
// 					chunks.push(chunk);
// 				});
// 				res.on("end", function () {
// 					var body = JSON.parse(Buffer.concat(chunks).toString());
// 					self.log.debug("Current Forecast: " + JSON.stringify(body));
//
// 					//Check for errors in response
// 					if (body.fault !== undefined) {
// 						self.log.error("Response has announced an error: " + body.fault.faultstring);
// 						if (body.fault.detail.errorcode.includes('InvalidAPICallAsNoApiProductMatchFound')){
// 							self.log.error("InvalidAPICallAsNoApiProductMatchFound: Wrong SRF-Product is linked to your SRF-App. Please choose the free SRF Product 'SRG-SSR-PUBLIC-API-V2'. Other SRF Prducts are not supported at the moment");
// 						}
// 						return;
// 					}
//
// 					if (body.code !== undefined) {
// 						self.log.debug("Current Forecast - Return Code: " + body.code.toString());
// 						if (body.code.toString() === "404.02.001") {
// 							self.log.error("Current Forecast - Requested Location is not supported. Please be aware, that this adapter only supports locations within Switzerland.");
// 							return;
// 						} else {
// 							self.log.error("Current Forecast - An error has occured. " + JSON.stringify(body));
// 							return;
// 						}
// 					}
//
// 					//**********************
// 					//*** Formatted Date
// 					//**********************
// 					//Set Current Forecast Values
// 					self.setObjectNotExists("CurrentForecast." + "formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("CurrentForecast." + "formatted_date", {
// 							val: body.formatted_date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					//**********************
// 					//*** Current Day
// 					//**********************
// 					self.setObjectNotExists("CurrentForecast.current_day.date", {
// 						type: "state",
// 						common: {
// 							name: "date",
// 							type: "string",
// 							role: "date"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("CurrentForecast.current_day.date", {
// 							val: body.current_day.date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("CurrentForecast.current_day.values.ttn", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttn.name + " " + body.units.ttn.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("CurrentForecast.current_day.values.ttn", {
// 							val: body.current_day.values[0].ttn,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("CurrentForecast.current_day.values.smbd", {
// 						type: "state",
// 						common: {
// 							name: body.units.smbd.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("CurrentForecast.current_day.values.smbd", {
// 							val: body.current_day.values[1].smbd,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("CurrentForecast.current_day.values.ttx", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttx.name + " " + body.units.ttx.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("CurrentForecast.current_day.values.ttx", {
// 							val: body.current_day.values[2].ttx,
// 							ack: true
// 						});
// 					});
//
// 					//read icon-name for current_day
// 					self.log.debug("get icon-url by xpath for current day");
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.current_day.values[1].smbd + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.current_day.values[1].smbd);
// 					} else {
// 						icon = gchild.text();
// 					}
//
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("CurrentForecast.current_day.values.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name current_day: " + this.icon);
// 						self.setState("CurrentForecast.current_day.values.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("CurrentForecast.current_day.values.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("CurrentForecast.current_day.values.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.current_day.values[1].smbd + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("CurrentForecast.current_day.values.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("CurrentForecast.current_day.values.icon-name", {
// 							val: this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
//
// 					//**********************
// 					//*** Current Hour
// 					//**********************
// 					if (Object.keys(body.current_hour).length > 0) {
// 						self.setObjectNotExists("CurrentForecast.current_hour.date", {
// 							type: "state",
// 							common: {
// 								name: "date",
// 								type: "string",
// 								role: "date"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.date", {
// 								val: body.current_hour[0].date.toString(),
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.smb3", {
// 							type: "state",
// 							common: {
// 								name: body.units.smb3.name,
// 								type: "string",
// 								role: "value"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.values.smb3", {
// 								val: body.current_hour[0].values[0].smb3,
// 								ack: true
// 							});
// 						});
//
// 						//read icon-name for current_hour
// 						self.log.debug("get icon-url by xpath for current hour");
// 						var gchild = xmlDoc.get("/root/row[Code=" + body.current_hour[0].values[0].smb3 + "]/Code_icon");
// 						if (gchild == undefined) {
// 							icon = "notavailable";
// 							self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.current_hour[0].values[0].smb3);
// 						} else {
// 							icon = gchild.text();
// 						}
// 						self.log.debug("Weather-Icon Name: " + icon);
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.icon-url", {
// 							type: "state",
// 							common: {
// 								name: "icon-url",
// 								type: "string",
// 								role: "weather.icon"
// 							},
// 							native: {},
// 						}, function () {
// 							self.log.debug("Weather-Icon Name current_hour: " + this.icon);
// 							self.setState("CurrentForecast.current_hour.values.icon-url", {
// 								val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 								ack: true
// 							});
// 						}.bind({icon: icon}));
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.icon-url-srgssr", {
// 							type: "state",
// 							common: {
// 								name: "icon-url-srgssr",
// 								type: "string",
// 								role: "weather.icon"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.values.icon-url-srgssr", {
// 								val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.current_hour[0].values[0].smb3 + ".png",
// 								ack: true
// 							});
// 						}.bind({icon: icon}));
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.icon-name", {
// 							type: "state",
// 							common: {
// 								name: "icon-name",
// 								type: "string",
// 								role: "weather.icon"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.values.icon-name", {
// 								val: this.icon + ".png",
// 								ack: true
// 							});
// 						}.bind({icon: icon}));
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.ttt", {
// 							type: "state",
// 							common: {
// 								name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 								type: "number",
// 								role: "value.temperature"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.values.ttt", {
// 								val: body.current_hour[0].values[1].ttt,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.fff", {
// 							type: "state",
// 							common: {
// 								name: body.units.fff.name + " in " + body.units.fff.unit,
// 								type: "number",
// 								role: "value.temperature"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.values.fff", {
// 								val: body.current_hour[0].values[2].fff,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.ffx3", {
// 							type: "state",
// 							common: {
// 								name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 								type: "number",
// 								role: "value.temperature"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.values.ffx3", {
// 								val: body.current_hour[0].values[3].ffx3,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.ddd", {
// 							type: "state",
// 							common: {
// 								name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 								type: "number",
// 								role: "value"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.values.ddd", {
// 								val: body.current_hour[0].values[4].ddd,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.rr3", {
// 							type: "state",
// 							common: {
// 								name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 								type: "number",
// 								role: "value"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.values.rr3", {
// 								val: body.current_hour[0].values[5].rr3,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("CurrentForecast.current_hour.values.pr3", {
// 							type: "state",
// 							common: {
// 								name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 								type: "number",
// 								role: "value"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("CurrentForecast.current_hour.values.pr3", {
// 								val: body.current_hour[0].values[6].pr3,
// 								ack: true
// 							});
// 						});
// 					} else {
// 						self.log.warn("CurrentForecast - Current_hour is empty. Do no import for this cycle")
// 					}
//
// 					//**********************
// 					//*** Info
// 					//**********************
// 					self.setObjectNotExists("info.id", {
// 						type: "state",
// 						common: {
// 							name: "id",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("info.id", {val: body.info.id, ack: true});
// 					});
//
// 					self.setObjectNotExists("info.plz", {
// 						type: "state",
// 						common: {
// 							name: "plz",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("info.plz", {val: body.info.plz, ack: true});
// 					});
//
// 					self.setObjectNotExists("info.name.de", {
// 						type: "state",
// 						common: {
// 							name: "name",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("info.name.de", {val: body.info.name.de, ack: true});
// 					});
//
// 					self.setObjectNotExists("CurrentForecast.status", {
// 						type: "state",
// 						common: {
// 							name: "status",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("CurrentForecast.status", {val: "Success", ack: true});
// 					});
//
// 				});
// 				res.on("error", function (error) {
// 					self.log.error(error);
// 					self.setObjectNotExists("CurrentForecast.status", {
// 						type: "state",
// 						common: {
// 							name: "status",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("CurrentForecast.status", {val: error, ack: true});
// 					});
// 				});
// 			});
// 			reqCurrentForecast.end();
//
// 			//********************************************************************************************
// 			//* Read Week Forcast
// 			//********************************************************************************************
//
// 			//Options for getting week forecast using Authorization Bearer
// 			var options_weeks_forecast = {
// 				"method": "GET",
// 				"hostname": "api.srgssr.ch",
// 				"port": null,
// 				"path": "/forecasts/v1.0/weather/7day?latitude=" + latitude + "&longitude=" + longitude,
// 				"headers": {
// 					"authorization": "Bearer " + access_token
// 				}
// 			};
// 			var reqWeekForecast = http.request(options_weeks_forecast, function (res) {
// 				var chunks = [];
// 				res.on("data", function (chunk) {
// 					chunks.push(chunk);
// 				});
// 				res.on("end", function () {
// 					var chunksConcat = Buffer.concat(chunks).toString();
// 					chunksConcat = chunksConcat.replace(/7days/g, "sevendays");
// 					self.log.debug("chunksConcat: " + chunksConcat);
// 					var body = JSON.parse(chunksConcat);
// 					self.log.debug("Week Forecast: " + JSON.stringify(body));
//
// 					//Check for errors in response
// 					if (body.fault !== undefined) {
// 						self.log.error("Response has announced an error: " + body.fault.faultstring);
// 						if (body.fault.detail.errorcode.includes('InvalidAPICallAsNoApiProductMatchFound')){
// 							self.log.error("InvalidAPICallAsNoApiProductMatchFound: Wrong SRF-Product is linked to your SRF-App. Please choose the free SRF Product 'SRG-SSR-PUBLIC-API-V2'. Other SRF Prducts are not supported at the moment");
// 						}
// 						return;
// 					}
//
// 					if (body.code !== undefined) {
// 						self.log.debug("Week Forecast:  - Return Code: " + body.code.toString());
// 						if (body.code.toString() === "404.02.001") {
// 							self.log.error("Week Forecast - Requested Location is not supported. Please be aware, that this adapter only supports locations within Switzerland.");
// 							return;
// 						} else {
// 							self.log.error("Week Forecast - An error has occured. " + JSON.stringify(body));
// 							return;
// 						}
// 					}
//
// 					//**********************
// 					//*** Day 0
// 					//**********************
// 					self.setObjectNotExists("WeekForecast.day0.formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day0.formatted_date", {
// 							val: body.sevendays[0].formatted_date,
// 							ack: true
// 						});
// 					});
// 					self.setObjectNotExists("WeekForecast.day0.ttn", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttn.name + " " + body.units.ttn.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day0.ttn", {val: body.sevendays[0].values[0].ttn, ack: true});
// 					});
// 					self.setObjectNotExists("WeekForecast.day0.smbd", {
// 						type: "state",
// 						common: {
// 							name: body.units.smbd.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day0.smbd", {val: body.sevendays[0].values[1].smbd, ack: true});
// 					});
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for weekforecast.day0");
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.sevendays[0].values[1].smbd + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.sevendays[0].values[1].smbd);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("WeekForecast.day0.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name day0: " + this.icon);
// 						self.setState("WeekForecast.day0.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day0.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day0.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.sevendays[0].values[1].smbd + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day0.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day0.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day0.ttx", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttx.name + " " + body.units.ttx.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day0.ttx", {val: body.sevendays[0].values[2].ttx, ack: true});
// 					});
//
// 					//**********************
// 					//*** Day 1
// 					//**********************
// 					self.setObjectNotExists("WeekForecast.day1.formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day1.formatted_date", {
// 							val: body.sevendays[1].formatted_date,
// 							ack: true
// 						});
// 					});
// 					self.setObjectNotExists("WeekForecast.day1.ttn", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttn.name + " " + body.units.ttn.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day1.ttn", {val: body.sevendays[1].values[0].ttn, ack: true});
// 					});
// 					self.setObjectNotExists("WeekForecast.day1.smbd", {
// 						type: "state",
// 						common: {
// 							name: body.units.smbd.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day1.smbd", {val: body.sevendays[1].values[1].smbd, ack: true});
// 					});
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for weekforecast.day1");
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.sevendays[1].values[1].smbd + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.sevendays[1].values[1].smbd);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("WeekForecast.day1.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name day1: " + this.icon);
// 						self.setState("WeekForecast.day1.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day1.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day1.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.sevendays[1].values[1].smbd + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day1.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day1.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day1.ttx", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttx.name + " " + body.units.ttx.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day1.ttx", {val: body.sevendays[1].values[2].ttx, ack: true});
// 					});
//
// 					//**********************
// 					//*** Day 2
// 					//**********************
// 					self.setObjectNotExists("WeekForecast.day2.formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day2.formatted_date", {
// 							val: body.sevendays[2].formatted_date,
// 							ack: true
// 						});
// 					});
// 					self.setObjectNotExists("WeekForecast.day2.ttn", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttn.name + " " + body.units.ttn.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day2.ttn", {val: body.sevendays[2].values[0].ttn, ack: true});
// 					});
// 					self.setObjectNotExists("WeekForecast.day2.smbd", {
// 						type: "state",
// 						common: {
// 							name: body.units.smbd.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day2.smbd", {val: body.sevendays[2].values[1].smbd, ack: true});
// 					});
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for weekforecast.day2");
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.sevendays[2].values[1].smbd + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.sevendays[2].values[1].smbd);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("WeekForecast.day2.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name day2: " + this.icon);
// 						self.setState("WeekForecast.day2.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day2.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day2.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.sevendays[2].values[1].smbd + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day2.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day2.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day2.ttx", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttx.name + " " + body.units.ttx.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day2.ttx", {val: body.sevendays[2].values[2].ttx, ack: true});
// 					});
//
// 					//**********************
// 					//*** Day 3
// 					//**********************
// 					self.setObjectNotExists("WeekForecast.day3.formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day3.formatted_date", {
// 							val: body.sevendays[3].formatted_date,
// 							ack: true
// 						});
// 					});
// 					self.setObjectNotExists("WeekForecast.day3.ttn", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttn.name + " " + body.units.ttn.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day3.ttn", {val: body.sevendays[3].values[0].ttn, ack: true});
// 					});
// 					self.setObjectNotExists("WeekForecast.day3.smbd", {
// 						type: "state",
// 						common: {
// 							name: body.units.smbd.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day3.smbd", {val: body.sevendays[3].values[1].smbd, ack: true});
// 					});
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for weekforecast.day3");
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.sevendays[3].values[1].smbd + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.sevendays[3].values[1].smbd);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("WeekForecast.day3.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name day3: " + this.icon);
// 						self.setState("WeekForecast.day3.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day3.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day3.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.sevendays[3].values[1].smbd + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day3.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day3.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day3.ttx", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttx.name + " " + body.units.ttx.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day3.ttx", {val: body.sevendays[3].values[2].ttx, ack: true});
// 					});
//
// 					//**********************
// 					//*** Day 4
// 					//**********************
// 					self.setObjectNotExists("WeekForecast.day4.formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day4.formatted_date", {
// 							val: body.sevendays[4].formatted_date,
// 							ack: true
// 						});
// 					});
// 					self.setObjectNotExists("WeekForecast.day4.ttn", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttn.name + " " + body.units.ttn.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day4.ttn", {val: body.sevendays[4].values[0].ttn, ack: true});
// 					});
// 					self.setObjectNotExists("WeekForecast.day4.smbd", {
// 						type: "state",
// 						common: {
// 							name: body.units.smbd.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day4.smbd", {val: body.sevendays[4].values[1].smbd, ack: true});
// 					});
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for weekforecast.day4");
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.sevendays[4].values[1].smbd + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.sevendays[4].values[1].smbd);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("WeekForecast.day4.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name day4: " + this.icon);
// 						self.setState("WeekForecast.day4.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day4.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day4.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.sevendays[4].values[1].smbd + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day4.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day4.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day4.ttx", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttx.name + " " + body.units.ttx.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day4.ttx", {val: body.sevendays[4].values[2].ttx, ack: true});
// 					});
//
// 					//**********************
// 					//*** Day 5
// 					//**********************
// 					self.setObjectNotExists("WeekForecast.day5.formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day5.formatted_date", {
// 							val: body.sevendays[5].formatted_date,
// 							ack: true
// 						});
// 					});
// 					self.setObjectNotExists("WeekForecast.day5.ttn", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttn.name + " " + body.units.ttn.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day5.ttn", {val: body.sevendays[5].values[0].ttn, ack: true});
// 					});
// 					self.setObjectNotExists("WeekForecast.day5.smbd", {
// 						type: "state",
// 						common: {
// 							name: body.units.smbd.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day5.smbd", {val: body.sevendays[5].values[1].smbd, ack: true});
// 					});
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for weekforecast.day5");
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.sevendays[5].values[1].smbd + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.sevendays[5].values[1].smbd);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("WeekForecast.day5.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name day5: " + this.icon);
// 						self.setState("WeekForecast.day5.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day5.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day5.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.sevendays[5].values[1].smbd + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day5.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day5.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day5.ttx", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttx.name + " " + body.units.ttx.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day5.ttx", {val: body.sevendays[5].values[2].ttx, ack: true});
// 					});
//
// 					//**********************
// 					//*** Day 6
// 					//**********************
// 					self.setObjectNotExists("WeekForecast.day6.formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day6.formatted_date", {
// 							val: body.sevendays[6].formatted_date,
// 							ack: true
// 						});
// 					});
// 					self.setObjectNotExists("WeekForecast.day6.ttn", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttn.name + " " + body.units.ttn.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day6.ttn", {val: body.sevendays[6].values[0].ttn, ack: true});
// 					});
// 					self.setObjectNotExists("WeekForecast.day6.smbd", {
// 						type: "state",
// 						common: {
// 							name: body.units.smbd.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day6.smbd", {val: body.sevendays[6].values[1].smbd, ack: true});
// 					});
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for weekforecast.day6");
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.sevendays[6].values[1].smbd + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.sevendays[6].values[1].smbd);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("WeekForecast.day6.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name day6: " + this.icon);
// 						self.setState("WeekForecast.day6.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day6.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day6.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.sevendays[6].values[1].smbd + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day6.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day6.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("WeekForecast.day6.ttx", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttx.name + " " + body.units.ttx.unit,
// 							type: "string",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.day6.ttx", {val: body.sevendays[6].values[2].ttx, ack: true});
// 					});
//
// 					self.setObjectNotExists("WeekForecast.status", {
// 						type: "state",
// 						common: {
// 							name: "status",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.status", {val: "Success", ack: true});
// 					});
// 				});
// 				res.on("error", function (error) {
// 					self.log.error(error);
// 					self.setObjectNotExists("WeekForecast.status", {
// 						type: "state",
// 						common: {
// 							name: "status",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("WeekForecast.status", {val: error, ack: true});
// 					});
// 				});
// 			});
// 			reqWeekForecast.end();
//
// 			//********************************************************************************************
// 			//* Read Hour Forcast
// 			//********************************************************************************************
//
// 			//Options for getting hour forecast using Authorization Bearer
// 			var options_hour_forecast = {
// 				"method": "GET",
// 				"hostname": "api.srgssr.ch",
// 				"port": null,
// 				"path": "/forecasts/v1.0/weather/nexthour?latitude=" + latitude + "&longitude=" + longitude,
// 				"headers": {
// 					"authorization": "Bearer " + access_token
// 				}
// 			};
// 			var reqHourForecast = http.request(options_hour_forecast, function (res) {
// 				var chunks = [];
// 				res.on("data", function (chunk) {
// 					chunks.push(chunk);
// 				});
// 				res.on("end", function () {
// 					var body = JSON.parse(Buffer.concat(chunks).toString());
// 					self.log.debug("Hour Forecast: " + JSON.stringify(body));
//
// 					//Check for errors in response
// 					if (body.fault !== undefined) {
// 						self.log.error("Response has announced an error: " + body.fault.faultstring);
// 						if (body.fault.detail.errorcode.includes('InvalidAPICallAsNoApiProductMatchFound')){
// 							self.log.error("InvalidAPICallAsNoApiProductMatchFound: Wrong SRF-Product is linked to your SRF-App. Please choose the free SRF Product 'SRG-SSR-PUBLIC-API-V2'. Other SRF Prducts are not supported at the moment");
// 						}
// 						return;
// 					}
//
// 					if (body.code !== undefined) {
// 						self.log.debug("Hour Forecast - Return Code: " + body.code.toString());
// 						if (body.code.toString() === "404.02.001") {
// 							self.log.error("Hour Forecast - Requested Location is not supported. Please be aware, that this adapter only supports locations within Switzerland.");
// 							return;
// 						} else {
// 							self.log.error("Hour Forecast - An error has occured. " + JSON.stringify(body));
// 							return;
// 						}
// 					}
//
// 					//**********************
// 					//*** Formatted Date
// 					//**********************
// 					//Set Current Forecast Values
// 					self.setObjectNotExists("HourForecast." + "formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("HourForecast." + "formatted_date", {
// 							val: body.formatted_date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					//**********************
// 					//*** Next Hour
// 					//**********************
// 					if (Object.keys(body.nexthour).length > 0) {
// 						self.setObjectNotExists("HourForecast.nexthour.date", {
// 							type: "state",
// 							common: {
// 								name: "date",
// 								type: "string",
// 								role: "date"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.date", {
// 								val: body.nexthour[0].date.toString(),
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.smb3", {
// 							type: "state",
// 							common: {
// 								name: body.units.smb3.name,
// 								type: "string",
// 								role: "value"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.values.smb3", {
// 								val: body.nexthour[0].values[0].smb3,
// 								ack: true
// 							});
// 						});
//
// 						//read icon-name
// 						self.log.debug("get icon-url by xpath for hourforecast.nexthour");
// 						var gchild = xmlDoc.get("/root/row[Code=" + body.nexthour[0].values[0].smb3 + "]/Code_icon");
// 						if (gchild == undefined) {
// 							icon = "notavailable";
// 							self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.nexthour[0].values[0].smb3);
// 						} else {
// 							icon = gchild.text();
// 						}
// 						self.log.debug("Weather-Icon Name: " + icon);
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.icon-url", {
// 							type: "state",
// 							common: {
// 								name: "icon-url",
// 								type: "string",
// 								role: "weather.icon"
// 							},
// 							native: {},
// 						}, function () {
// 							self.log.debug("Weather-Icon Name nexthour: " + this.icon);
// 							self.setState("HourForecast.nexthour.values.icon-url", {
// 								val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 								ack: true
// 							});
// 						}.bind({icon: icon}));
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.icon-url-srgssr", {
// 							type: "state",
// 							common: {
// 								name: "icon-url-srgssr",
// 								type: "string",
// 								role: "weather.icon"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.values.icon-url-srgssr", {
// 								val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.nexthour[0].values[0].smb3 + ".png",
// 								ack: true
// 							});
// 						}.bind({icon: icon}));
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.icon-name", {
// 							type: "state",
// 							common: {
// 								name: "icon-name",
// 								type: "string",
// 								role: "weather.icon"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.values.icon-name", {
// 								val: this.icon + ".png",
// 								ack: true
// 							});
// 						}.bind({icon: icon}));
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.ttt", {
// 							type: "state",
// 							common: {
// 								name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 								type: "number",
// 								role: "value.temperature"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.values.ttt", {
// 								val: body.nexthour[0].values[1].ttt,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.fff", {
// 							type: "state",
// 							common: {
// 								name: body.units.fff.name + " in " + body.units.fff.unit,
// 								type: "number",
// 								role: "value.temperature"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.values.fff", {
// 								val: body.nexthour[0].values[2].fff,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.ffx3", {
// 							type: "state",
// 							common: {
// 								name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 								type: "number",
// 								role: "value.temperature"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.values.ffx3", {
// 								val: body.nexthour[0].values[3].ffx3,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.ddd", {
// 							type: "state",
// 							common: {
// 								name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 								type: "number",
// 								role: "value"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.values.ddd", {
// 								val: body.nexthour[0].values[4].ddd,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.rr3", {
// 							type: "state",
// 							common: {
// 								name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 								type: "number",
// 								role: "value"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.values.rr3", {
// 								val: body.nexthour[0].values[5].rr3,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("HourForecast.nexthour.values.pr3", {
// 							type: "state",
// 							common: {
// 								name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 								type: "number",
// 								role: "value"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.nexthour.values.pr3", {
// 								val: body.nexthour[0].values[6].pr3,
// 								ack: true
// 							});
// 						});
//
// 						self.setObjectNotExists("HourForecast.status", {
// 							type: "state",
// 							common: {
// 								name: "status",
// 								type: "string",
// 								role: "text"
// 							},
// 							native: {},
// 						}, function () {
// 							self.setState("HourForecast.status", {val: "Success", ack: true});
// 						});
//
// 					} else {
// 						self.log.warn("Hour Forecast - nexthour is empty. Do no import for this cycle")
// 					}
// 				});
// 				res.on("error", function (error) {
// 					self.log.error(error);
//
// 					self.setObjectNotExists("HourForecast.status", {
// 						type: "state",
// 						common: {
// 							name: "status",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("HourForecast.status", {val: error, ack: true});
// 					});
// 				});
// 			});
// 			reqHourForecast.end();
//
// 			//********************************************************************************************
// 			//* Read 24h Forcast
// 			//********************************************************************************************
//
// 			//Options for getting 24h forecast using Authorization Bearer
// 			var options_24h_forecast = {
// 				"method": "GET",
// 				"hostname": "api.srgssr.ch",
// 				"port": null,
// 				"path": "/forecasts/v1.0/weather/24hour?latitude=" + latitude + "&longitude=" + longitude,
// 				"headers": {
// 					"authorization": "Bearer " + access_token
// 				}
// 			};
// 			var req24hForecast = http.request(options_24h_forecast, function (res) {
// 				var chunks = [];
// 				res.on("data", function (chunk) {
// 					chunks.push(chunk);
// 				});
// 				res.on("end", function () {
// 					var chunksConcat = Buffer.concat(chunks).toString();
// 					chunksConcat = chunksConcat.replace(/24hours/g, "twentyfourhours");
// 					self.log.debug("chunksConcat: " + chunksConcat);
// 					var body = JSON.parse(chunksConcat);
// 					self.log.debug("24h Forecast: " + JSON.stringify(body));
//
// 					//Check for errors in response
// 					if (body.fault !== undefined) {
// 						self.log.error("Response has announced an error: " + body.fault.faultstring);
// 						if (body.fault.detail.errorcode.includes('InvalidAPICallAsNoApiProductMatchFound')){
// 							self.log.error("InvalidAPICallAsNoApiProductMatchFound: Wrong SRF-Product is linked to your SRF-App. Please choose the free SRF Product 'SRG-SSR-PUBLIC-API-V2'. Other SRF Prducts are not supported at the moment");
// 						}
// 						return;
// 					}
//
// 					if (body.code !== undefined) {
// 						self.log.debug("24h Forecast - Return Code: " + body.code.toString());
// 						if (body.code.toString() === "404.02.001") {
// 							self.log.error("24h Forecast - Requested Location is not supported. Please be aware, that this adapter only supports locations within Switzerland.");
// 							return;
// 						} else {
// 							self.log.error("24h Forecast - An error has occured. " + JSON.stringify(body));
// 							return;
// 						}
// 					}
//
// 					//**********************
// 					//*** Formatted Date
// 					//**********************
// 					self.setObjectNotExists("24hForecast.formatted_date", {
// 						type: "state",
// 						common: {
// 							name: "formatted_date",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.formatted_date", {
// 							val: body.formatted_date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					//************************
// 					//*** 24h Hours - hour 0
// 					//************************
// 					self.setObjectNotExists("24hForecast.hour0.date", {
// 						type: "state",
// 						common: {
// 							name: "date",
// 							type: "string",
// 							role: "date"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.date", {
// 							val: body.twentyfourhours[0].date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour0.values.smb3", {
// 						type: "state",
// 						common: {
// 							name: body.units.smb3.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.values.smb3", {
// 							val: body.twentyfourhours[0].values[0].smb3,
// 							ack: true
// 						});
// 					});
//
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for 24h forecast.hour0: " + body.twentyfourhours[0].values[0].smb3);
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.twentyfourhours[0].values[0].smb3 + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.twentyfourhours[0].values[0].smb3);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("24hForecast.hour0.values.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name hour0: " + this.icon);
// 						self.setState("24hForecast.hour0.values.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour0.values.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.values.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.twentyfourhours[0].values[0].smb3 + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour0.values.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.values.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour0.values.ttt", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.values.ttt", {
// 							val: body.twentyfourhours[0].values[1].ttt,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour0.values.fff", {
// 						type: "state",
// 						common: {
// 							name: body.units.fff.name + " in " + body.units.fff.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.values.fff", {
// 							val: body.twentyfourhours[0].values[2].fff,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour0.values.ffx3", {
// 						type: "state",
// 						common: {
// 							name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.values.ffx3", {
// 							val: body.twentyfourhours[0].values[3].ffx3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour0.values.ddd", {
// 						type: "state",
// 						common: {
// 							name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.values.ddd", {
// 							val: body.twentyfourhours[0].values[4].ddd,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour0.values.rr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.values.rr3", {
// 							val: body.twentyfourhours[0].values[5].rr3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour0.values.pr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour0.values.pr3", {
// 							val: body.twentyfourhours[0].values[6].pr3,
// 							ack: true
// 						});
// 					});
//
// 					//************************
// 					//*** 24h Hours - hour 1
// 					//************************
// 					self.setObjectNotExists("24hForecast.hour1.date", {
// 						type: "state",
// 						common: {
// 							name: "date",
// 							type: "string",
// 							role: "date"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.date", {
// 							val: body.twentyfourhours[1].date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour1.values.smb3", {
// 						type: "state",
// 						common: {
// 							name: body.units.smb3.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.values.smb3", {
// 							val: body.twentyfourhours[1].values[0].smb3,
// 							ack: true
// 						});
// 					});
//
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for 24h forecast.hour1: " + body.twentyfourhours[1].values[0].smb3);
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.twentyfourhours[1].values[0].smb3 + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.twentyfourhours[1].values[0].smb3);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("24hForecast.hour1.values.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name hour1: " + this.icon);
// 						self.setState("24hForecast.hour1.values.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour1.values.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.values.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.twentyfourhours[1].values[0].smb3 + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour1.values.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.values.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour1.values.ttt", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.values.ttt", {
// 							val: body.twentyfourhours[1].values[1].ttt,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour1.values.fff", {
// 						type: "state",
// 						common: {
// 							name: body.units.fff.name + " in " + body.units.fff.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.values.fff", {
// 							val: body.twentyfourhours[1].values[2].fff,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour1.values.ffx3", {
// 						type: "state",
// 						common: {
// 							name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.values.ffx3", {
// 							val: body.twentyfourhours[1].values[3].ffx3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour1.values.ddd", {
// 						type: "state",
// 						common: {
// 							name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.values.ddd", {
// 							val: body.twentyfourhours[1].values[4].ddd,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour1.values.rr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.values.rr3", {
// 							val: body.twentyfourhours[1].values[5].rr3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour1.values.pr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour1.values.pr3", {
// 							val: body.twentyfourhours[1].values[6].pr3,
// 							ack: true
// 						});
// 					});
//
// 					//************************
// 					//*** 24h Hours - hour 2
// 					//************************
// 					self.setObjectNotExists("24hForecast.hour2.date", {
// 						type: "state",
// 						common: {
// 							name: "date",
// 							type: "string",
// 							role: "date"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.date", {
// 							val: body.twentyfourhours[2].date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour2.values.smb3", {
// 						type: "state",
// 						common: {
// 							name: body.units.smb3.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.values.smb3", {
// 							val: body.twentyfourhours[2].values[0].smb3,
// 							ack: true
// 						});
// 					});
//
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for 24h forecast.hour2: " + body.twentyfourhours[2].values[0].smb3);
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.twentyfourhours[2].values[0].smb3 + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.twentyfourhours[2].values[0].smb3);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("24hForecast.hour2.values.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name hour2: " + this.icon);
// 						self.setState("24hForecast.hour2.values.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour2.values.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.values.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.twentyfourhours[2].values[0].smb3 + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour2.values.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.values.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour2.values.ttt", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.values.ttt", {
// 							val: body.twentyfourhours[2].values[1].ttt,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour2.values.fff", {
// 						type: "state",
// 						common: {
// 							name: body.units.fff.name + " in " + body.units.fff.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.values.fff", {
// 							val: body.twentyfourhours[2].values[2].fff,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour2.values.ffx3", {
// 						type: "state",
// 						common: {
// 							name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.values.ffx3", {
// 							val: body.twentyfourhours[2].values[3].ffx3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour2.values.ddd", {
// 						type: "state",
// 						common: {
// 							name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.values.ddd", {
// 							val: body.twentyfourhours[2].values[4].ddd,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour2.values.rr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.values.rr3", {
// 							val: body.twentyfourhours[2].values[5].rr3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour2.values.pr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour2.values.pr3", {
// 							val: body.twentyfourhours[2].values[6].pr3,
// 							ack: true
// 						});
// 					});
//
// 					//************************
// 					//*** 24h Hours - hour 3
// 					//************************
// 					self.setObjectNotExists("24hForecast.hour3.date", {
// 						type: "state",
// 						common: {
// 							name: "date",
// 							type: "string",
// 							role: "date"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.date", {
// 							val: body.twentyfourhours[3].date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour3.values.smb3", {
// 						type: "state",
// 						common: {
// 							name: body.units.smb3.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.values.smb3", {
// 							val: body.twentyfourhours[3].values[0].smb3,
// 							ack: true
// 						});
// 					});
//
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for 24h forecast.hour3: " + body.twentyfourhours[3].values[0].smb3);
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.twentyfourhours[3].values[0].smb3 + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.twentyfourhours[3].values[0].smb3);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("24hForecast.hour3.values.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name hour3: " + this.icon);
// 						self.setState("24hForecast.hour3.values.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour3.values.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.values.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.twentyfourhours[3].values[0].smb3 + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour3.values.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.values.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour3.values.ttt", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.values.ttt", {
// 							val: body.twentyfourhours[3].values[1].ttt,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour3.values.fff", {
// 						type: "state",
// 						common: {
// 							name: body.units.fff.name + " in " + body.units.fff.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.values.fff", {
// 							val: body.twentyfourhours[3].values[2].fff,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour3.values.ffx3", {
// 						type: "state",
// 						common: {
// 							name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.values.ffx3", {
// 							val: body.twentyfourhours[3].values[3].ffx3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour3.values.ddd", {
// 						type: "state",
// 						common: {
// 							name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.values.ddd", {
// 							val: body.twentyfourhours[3].values[4].ddd,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour3.values.rr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.values.rr3", {
// 							val: body.twentyfourhours[3].values[5].rr3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour3.values.pr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour3.values.pr3", {
// 							val: body.twentyfourhours[3].values[6].pr3,
// 							ack: true
// 						});
// 					});
//
// 					//************************
// 					//*** 24h Hours - hour 4
// 					//************************
// 					self.setObjectNotExists("24hForecast.hour4.date", {
// 						type: "state",
// 						common: {
// 							name: "date",
// 							type: "string",
// 							role: "date"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.date", {
// 							val: body.twentyfourhours[4].date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour4.values.smb3", {
// 						type: "state",
// 						common: {
// 							name: body.units.smb3.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.values.smb3", {
// 							val: body.twentyfourhours[4].values[0].smb3,
// 							ack: true
// 						});
// 					});
//
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for 24h forecast.hour4: " + body.twentyfourhours[4].values[0].smb3);
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.twentyfourhours[4].values[0].smb3 + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.twentyfourhours[4].values[0].smb3);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("24hForecast.hour4.values.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name hour4: " + this.icon);
// 						self.setState("24hForecast.hour4.values.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour4.values.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.values.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.twentyfourhours[4].values[0].smb3 + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour4.values.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.values.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour4.values.ttt", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.values.ttt", {
// 							val: body.twentyfourhours[4].values[1].ttt,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour4.values.fff", {
// 						type: "state",
// 						common: {
// 							name: body.units.fff.name + " in " + body.units.fff.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.values.fff", {
// 							val: body.twentyfourhours[4].values[2].fff,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour4.values.ffx3", {
// 						type: "state",
// 						common: {
// 							name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.values.ffx3", {
// 							val: body.twentyfourhours[4].values[3].ffx3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour4.values.ddd", {
// 						type: "state",
// 						common: {
// 							name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.values.ddd", {
// 							val: body.twentyfourhours[4].values[4].ddd,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour4.values.rr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.values.rr3", {
// 							val: body.twentyfourhours[4].values[5].rr3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour4.values.pr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour4.values.pr3", {
// 							val: body.twentyfourhours[4].values[6].pr3,
// 							ack: true
// 						});
// 					});
//
// 					//************************
// 					//*** 24h Hours - hour 5
// 					//************************
// 					self.setObjectNotExists("24hForecast.hour5.date", {
// 						type: "state",
// 						common: {
// 							name: "date",
// 							type: "string",
// 							role: "date"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour5.date", {
// 							val: body.twentyfourhours[5].date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour5.values.smb3", {
// 						type: "state",
// 						common: {
// 							name: body.units.smb3.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour5.values.smb3", {
// 							val: body.twentyfourhours[5].values[0].smb3,
// 							ack: true
// 						});
// 					});
//
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for 24h forecast.hour5: " + body.twentyfourhours[5].values[0].smb3);
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.twentyfourhours[5].values[0].smb3 + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.twentyfourhours[5].values[0].smb3);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("24hForecast.hour5.values.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name hour5: " + this.icon);
// 						self.setState("24hForecast.hour5.values.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour5.values.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name hour5: " + this.icon);
// 						self.setState("24hForecast.hour5.values.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.twentyfourhours[5].values[0].smb3 + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour5.values.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour5.values.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour5.values.ttt", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour5.values.ttt", {
// 							val: body.twentyfourhours[5].values[1].ttt,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour5.values.fff", {
// 						type: "state",
// 						common: {
// 							name: body.units.fff.name + " in " + body.units.fff.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour5.values.fff", {
// 							val: body.twentyfourhours[5].values[2].fff,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour5.values.ffx3", {
// 						type: "state",
// 						common: {
// 							name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour5.values.ffx3", {
// 							val: body.twentyfourhours[5].values[3].ffx3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour5.values.ddd", {
// 						type: "state",
// 						common: {
// 							name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour5.values.ddd", {
// 							val: body.twentyfourhours[5].values[4].ddd,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour5.values.rr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour5.values.rr3", {
// 							val: body.twentyfourhours[5].values[5].rr3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour5.values.pr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour5.values.pr3", {
// 							val: body.twentyfourhours[5].values[6].pr3,
// 							ack: true
// 						});
// 					});
//
// 					//************************
// 					//*** 24h Hours - hour 6
// 					//************************
// 					self.setObjectNotExists("24hForecast.hour6.date", {
// 						type: "state",
// 						common: {
// 							name: "date",
// 							type: "string",
// 							role: "date"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.date", {
// 							val: body.twentyfourhours[6].date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour6.values.smb3", {
// 						type: "state",
// 						common: {
// 							name: body.units.smb3.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.values.smb3", {
// 							val: body.twentyfourhours[6].values[0].smb3,
// 							ack: true
// 						});
// 					});
//
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for 24h forecast.hour6: " + body.twentyfourhours[6].values[0].smb3);
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.twentyfourhours[6].values[0].smb3 + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.twentyfourhours[6].values[0].smb3);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("24hForecast.hour6.values.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name hour6: " + this.icon);
// 						self.setState("24hForecast.hour6.values.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour6.values.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.values.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.twentyfourhours[6].values[0].smb3 + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour6.values.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.values.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour6.values.ttt", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.values.ttt", {
// 							val: body.twentyfourhours[6].values[1].ttt,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour6.values.fff", {
// 						type: "state",
// 						common: {
// 							name: body.units.fff.name + " in " + body.units.fff.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.values.fff", {
// 							val: body.twentyfourhours[6].values[2].fff,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour6.values.ffx3", {
// 						type: "state",
// 						common: {
// 							name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.values.ffx3", {
// 							val: body.twentyfourhours[6].values[3].ffx3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour6.values.ddd", {
// 						type: "state",
// 						common: {
// 							name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.values.ddd", {
// 							val: body.twentyfourhours[6].values[4].ddd,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour6.values.rr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.values.rr3", {
// 							val: body.twentyfourhours[6].values[5].rr3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour6.values.pr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour6.values.pr3", {
// 							val: body.twentyfourhours[6].values[6].pr3,
// 							ack: true
// 						});
// 					});
//
// 					//************************
// 					//*** 24h Hours - hour 7
// 					//************************
// 					self.setObjectNotExists("24hForecast.hour7.date", {
// 						type: "state",
// 						common: {
// 							name: "date",
// 							type: "string",
// 							role: "date"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.date", {
// 							val: body.twentyfourhours[7].date.toString(),
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour7.values.smb3", {
// 						type: "state",
// 						common: {
// 							name: body.units.smb3.name,
// 							type: "string",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.values.smb3", {
// 							val: body.twentyfourhours[7].values[0].smb3,
// 							ack: true
// 						});
// 					});
//
// 					//read icon-name
// 					self.log.debug("get icon-url by xpath for 24h forecast.hour7: " + body.twentyfourhours[7].values[0].smb3);
// 					var gchild = xmlDoc.get("/root/row[Code=" + body.twentyfourhours[7].values[0].smb3 + "]/Code_icon");
// 					if (gchild == undefined) {
// 						icon = "notavailable";
// 						self.log.info("Icon could not be found. Please create an issue on github. Icon number was: " + body.twentyfourhours[7].values[0].smb3);
// 					} else {
// 						icon = gchild.text();
// 					}
// 					self.log.debug("Weather-Icon Name: " + icon);
//
// 					self.setObjectNotExists("24hForecast.hour7.values.icon-url", {
// 						type: "state",
// 						common: {
// 							name: "icon-url",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.log.debug("Weather-Icon Name hour7: " + this.icon);
// 						self.setState("24hForecast.hour7.values.icon-url", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/weather-icons/png_64x64/" + this.icon + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour7.values.icon-url-srgssr", {
// 						type: "state",
// 						common: {
// 							name: "icon-url-srgssr",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.values.icon-url-srgssr", {
// 							val: "https://raw.githubusercontent.com/baerengraben/ioBroker.swiss-weather-api/master/img/srgssr/" + body.twentyfourhours[7].values[0].smb3 + ".png",
// 							ack: true
// 						});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour7.values.icon-name", {
// 						type: "state",
// 						common: {
// 							name: "icon-name",
// 							type: "string",
// 							role: "weather.icon"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.values.icon-name", {val: this.icon + ".png", ack: true});
// 					}.bind({icon: icon}));
//
// 					self.setObjectNotExists("24hForecast.hour7.values.ttt", {
// 						type: "state",
// 						common: {
// 							name: body.units.ttt.name + " in " + body.units.ttt.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.values.ttt", {
// 							val: body.twentyfourhours[7].values[1].ttt,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour7.values.fff", {
// 						type: "state",
// 						common: {
// 							name: body.units.fff.name + " in " + body.units.fff.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.values.fff", {
// 							val: body.twentyfourhours[7].values[2].fff,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour7.values.ffx3", {
// 						type: "state",
// 						common: {
// 							name: body.units.ffx3.name + " in " + body.units.ffx3.unit,
// 							type: "number",
// 							role: "value.temperature"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.values.ffx3", {
// 							val: body.twentyfourhours[7].values[3].ffx3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour7.values.ddd", {
// 						type: "state",
// 						common: {
// 							name: body.units.ddd.name + " in " + body.units.ddd.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.values.ddd", {
// 							val: body.twentyfourhours[7].values[4].ddd,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour7.values.rr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.rr3.name + " in " + body.units.rr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.values.rr3", {
// 							val: body.twentyfourhours[7].values[5].rr3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.hour7.values.pr3", {
// 						type: "state",
// 						common: {
// 							name: body.units.pr3.name + " in " + body.units.pr3.unit,
// 							type: "number",
// 							role: "value"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.hour7.values.pr3", {
// 							val: body.twentyfourhours[7].values[6].pr3,
// 							ack: true
// 						});
// 					});
//
// 					self.setObjectNotExists("24hForecast.status", {
// 						type: "state",
// 						common: {
// 							name: "status",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.status", {val: "success", ack: true});
// 					});
// 				});
//
// 				res.on("error", function (error) {
// 					self.log.error(error);
// 					self.setObjectNotExists("24hForecast.status", {
// 						type: "state",
// 						common: {
// 							name: "status",
// 							type: "string",
// 							role: "text"
// 						},
// 						native: {},
// 					}, function () {
// 						self.setState("24hForecast.status", {val: error, ack: true});
// 					});
// 				});
// 			});
// 			req24hForecast.end();
// 		});
// 		res.on("error", function (error) {
// 			self.log.error(error)
// 		});
// 	});
// 	req.end();
// 	setTimeout(doIt, pollInterval, self);
// }

// @ts-ignore parent is a valid property on module
if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new SwissWeatherApi(options);
} else {
	// otherwise start the instance directly
	new SwissWeatherApi();
}