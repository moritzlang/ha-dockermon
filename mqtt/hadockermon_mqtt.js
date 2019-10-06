module.exports = {
    config: null,
    mqtt_client: null,
    docker: null,

    init: function(config, mqtt_client, docker)
    {
        this.config = config;
        this.mqtt_client = mqtt_client;
        this.docker = docker;
    },

    checkDeletedContainers: function(pushedContainers)
    {
        for (i in this.mqttContainers) {
            if (pushedContainers.indexOf(i) < 0) {
                //Was not pushed? Increment errors
                this.mqttContainers[i].errors++;

                //If we have three strikes, you're out!
                if (mqttContainers[i].errors === 3) {
                    this.mqttRemove(i);
                }
            } else {
                this.mqttContainers[i].errors = 0;
            }
        }
    },

    handleMessage: function(topic, message, packet){
        //Extract the topic we were sent on
        var container_name = topic.replace(hadockermon.config.get("mqtt.base_topic") + "/", "").replace("/set", "");
    
        //Switch based on the type of message
        if (message == "stop" || (hadockermon.config.get("mqtt.hass_discovery.enabled") && message == "off")) {
            if (!hadockermon.isWhitelisted(container_name)) {
                //This container is not whitelisted
                return;
            }

            if (hadockermon.config.get("debug")) {
                console.log("Stopping container " + container_name);
            }
            
            getContainer(container_name, function (container) {
                docker.getContainer(container.Id).stop(function (err, data) {
                    if (err) {
                        return;
                    }
                    setTimeout(function(){
                        hadockermon.publishMqtt(mqtt_client);
                    }, 2000);
                });
            }, function (status, message) {
                console.log("Something went wrong? " + status + " " + message);
                res.status(status);
                if (message) {
                    res.send(message);
                }
            })
        } else if (message == "start" || (this.config.get("mqtt.hass_discovery.enabled") && message == "on")) {
            if (!hadockermon.isWhitelisted(container_name)) {
                //This container is not whitelisted
                return;
            }
            getContainer(container_name, function (container) {
                docker.getContainer(container.Id).start(function (err, data) {
                    if (err) {
                        return;
                    }
                    setTimeout(function(){
                        hadockermon.publishMqtt(mqtt_client);
                    }, 2000);
                });
            }, function (status, message) {
                console.log("Something went wrong? " + status + " " + message);
                res.status(status);
                if (message) {
                    res.send(message);
                }
            })
        }
        
    },

    initializeEntities: function (name, containerInfo)
    {
        if (this.config.get("debug")) {
            console.log("Setting up entity via HASS discovery for " + name);
        }

        //Publish to the Home Assistant topic with a switch
        var jsonConfig = {
            name: name,
            state_topic: this.config.get("mqtt.base_topic") + "/" + name + "/state",
            command_topic: this.config.get("mqtt.base_topic") + "/" + name + "/set",
            availability_topic: this.config.get("mqtt.base_topic") + "/status",
            payload_on: "on",
            payload_off: "off",
            payload_available: "online",
            payload_not_available: "offline",
            unique_id: this.config.get("mqtt.base_topic").replace("/","_") + name.replace("-", "_"),
            json_attributes_topic: this.config.get("mqtt.base_topic") + "/" + name + "/attributes"
        }

        this.mqtt_client.publish(this.config.get("mqtt.hass_discovery.base_topic") + "/switch/" + this.config.get("mqtt.base_topic").replace("/", "_") + "/" + name.replace("-", "_") + "/config", JSON.stringify(jsonConfig), {
            retain: true
        });
    },

    isWhitelisted: function(name){
        if (this.config.get('mqtt.whitelist_containers') !== undefined) {
            //Is the name of this container on the whitelist?
            return this.config.get('mqtt.whitelist_containers').includes(name);
        }

        return true;
    },

    hassDiscoveryPublish: function(name, containerInfo)
    {
        if (this.config.get("debug")) {
            console.log("Sending discovery state message for " + name);
        }
        var state = "off";
        var containerState = containerInfo.SynoStatus || containerInfo.State;
        if (containerState == "running") {
            state = "on";
        }
        this.mqtt_client.publish(this.config.get("mqtt.base_topic") + "/" + name + "/state", state , {
            retain: true
        });

        //Now publish some attributes

        //Container name, status, image name, running since
        var jsonAttributes = {
            name: name,
            icon: "mdi:docker",
            status: containerInfo.Status,
            state:  containerState
        }
        if (containerInfo.Image) {
            jsonAttributes.image = containerInfo.Image;
        }

        //Customise the icon based on the image
        if (jsonAttributes.image) {
            if (jsonAttributes.image.indexOf("homeassistant") > -1) {
                jsonAttributes.icon = "mdi:home-assistant";
            } else if (jsonAttributes.image.indexOf("zigbee2mqtt") > -1) {
                jsonAttributes.icon = "mdi:zigbee";
            } else if (jsonAttributes.image.indexOf("plex") > -1 || jsonAttributes.image.indexOf("tautulli") > -1) {
                jsonAttributes.icon = "mdi:plex";
            } else if (jsonAttributes.image.indexOf("zwave") > -1 || jsonAttributes.image.indexOf("z-wave") > -1) {
                jsonAttributes.icon = "mdi:z-wave";
            } else if (jsonAttributes.image.indexOf("mysql") > -1 || jsonAttributes.image.indexOf("mariadb") > -1  || jsonAttributes.image.indexOf("influx") > -1) {
                jsonAttributes.icon = "mdi:database";
            } else if (jsonAttributes.image.indexOf("transmission") > -1 || jsonAttributes.image.indexOf("nzbget") > -1) {
                jsonAttributes.icon = "mdi:download-multiple";
            } else if (jsonAttributes.image.indexOf("radarr") > -1 || jsonAttributes.image.indexOf("sonarr") > -1) {
                jsonAttributes.icon = "mdi:radar";
            } else if (jsonAttributes.image.indexOf("vpn") > -1) {
                jsonAttributes.icon = "mdi:vpn";
            } else if (jsonAttributes.image.indexOf("traccar") > -1) {
                jsonAttributes.icon = "mdi:crosshairs-gps";
            } else if (jsonAttributes.image.indexOf("alexa") > -1) {
                jsonAttributes.icon = "mdi:amazon-alexa";
            } else if (jsonAttributes.image.indexOf("homekit") > -1 || jsonAttributes.image.indexOf("homebridge") > -1) {
                jsonAttributes.icon = "mdi:apple";
            } else if (jsonAttributes.image.indexOf("nodered") > -1 || jsonAttributes.image.indexOf("node-red") > -1) {
                jsonAttributes.icon = "mdi:nodejs";
            }

        }

        this.mqtt_client.publish(this.config.get("mqtt.base_topic") + "/" + name + "/attributes", JSON.stringify(jsonAttributes), {
            retain: false
        });
    },

    mqttRemove: function(name)
    {
        //Publish a remove topic
        if (this.config.get("mqtt.hass_discovery.enabled")) {
            this.mqtt_client.publish(this.config.get("mqtt.hass_discovery.base_topic") + "/switch/" + this.config.get("mqtt.base_topic").replace("/","_") + name.replace("-", "_") + "/config", "", {
                retain: false
            });
        } else {
            //Just publish the state as destroyed
            this.mqtt_client.publish(this.config.get("mqtt.base_topic") + "/" + name + "/state", "destroyed", {
                retain: false
            });
        }
    },

    publishMqtt: function()
    {
        //Store the containers we published to in an array for tracking later
        this.pushedContainers = [];

        //Get all containers
        hadockermon = this;
        this.docker.listContainers( {
            all: true
        }, function (err, containers) {
            containers.forEach(function (containerInfo, idx, all_containers) {
                //Use the first name index as the name for this container
                var name = hadockermon.topicName(containerInfo.Names);

                if (!hadockermon.isWhitelisted(name)) {
                    //This container is not whitelisted so don't publish it
                    return;
                }

                //Are we already tracking this container?
                if (!hadockermon.mqttContainers[name]) {
                    //No, subscribe to this topic!
                    hadockermon.subscribe(name);
                    if (hadockermon.config.get("mqtt.hass_discovery.enabled")) {
                        hadockermon.initializeEntities(name, containerInfo);
                    }
                }

                if (hadockermon.config.get("mqtt.hass_discovery.enabled")) {
                    hadockermon.hassDiscoveryPublish(name, containerInfo);
                } else {
                    //Just publish the state
                    hadockermon.mqtt_client.publish(hadockermon.config.get("mqtt.base_topic") + "/" + name + "/state", containerInfo.State , {
                        retain: false
                    });
                }

                hadockermon.pushedContainers.push(name);

                //If this is the last item, we need to check for any deleted items
                if (idx === all_containers.length - 1){ 
                    hadockermon.checkDeletedContainers(hadockermon.pushedContainers);
                }
            });
        });
    },

    startMqtt: function() {    
        var loop_interval = this.config.get("mqtt.scan_interval");
    
        //Store an array of containers we have tracked
        //If we can't detect this container, we'll assume it has been deleted
        //and remove the entity from Home Assistant if applicable
    
        this.mqttContainers = {};
    
        this.publishMqtt();

        hadockermon = this;

        this.mqtt_client.on('message', hadockermon.handleMessage)
    
        this.mqttPublisher = setInterval(function(){
            hadockermon.publishMqtt(mqtt_client);
        }, loop_interval * 1000);

        var topic = this.config.get("mqtt.base_topic") + "/status";
        this.mqtt_client.publish(topic, "online", {
            retain: true
        });
    
        this.mqtt_client.on('disconnect', function(){
            console.log("MQTT disconnected");
            clearInterval(this.mqttPublisher);
        });
    
        // process.exit();
    },

    subscribe: function(name)
    {
        this.mqttContainers[name] = {
            errors: 0
        }

        if (this.config.get("debug")) {
            console.log("Subscribing to " + this.config.get("mqtt.base_topic") + "/" + name + "/set");
        }

        this.mqtt_client.subscribe(this.config.get("mqtt.base_topic") + "/" + name + "/set");
    },

    topicName: function(names)
    {
        if (names[0]) {
            name = names[0];
            if (name[0] == "/") {
                name = name.substr(1);
            }
        }
        
        return name;
    }
}