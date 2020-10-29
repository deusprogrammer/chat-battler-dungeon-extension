import React from 'react'
import Authentication from '../../util/Authentication/Authentication'
import { w3cwebsocket as W3CWebSocket } from "websocket";

import ApiHelper from './ApiHelper';
import config from './config';

import './App.css'
import axios from 'axios';

export default class App extends React.Component{
    constructor(props) {
        super(props)
        this.Authentication = new Authentication()

        //if the extension is running on twitch or dev rig, set the shorthand here. otherwise, set to null. 
        this.twitch = window.Twitch ? window.Twitch.ext : null
        this.ws = null;
        this.pingReceived = false;
        this.pingInterval = null;
        this.state = {
            finishedLoading: false,
            theme: 'light',
            isVisible: true,
            mode: "stats",
            action: "",
            selection: "",
            players: [],
            monsters: [],
            error: false,
            errorInfo: "",
            hasBattler: true,
            ready: false,
            botIsLive: false,
            connecting: false
        }
    }

    connect() {
        this.ws = new W3CWebSocket(config.WS_URL);
        let jwt = this.jwt
        this.ws.onopen = () => {
            this.setState({connecting: false, wsError: null});
            this.ws.send(JSON.stringify({
                type: "REGISTER",
                jwt
            }));

            this.ws.send(JSON.stringify({
                type: "CONTEXT",
                jwt,
                to: `BOT-${this.channelId}`
            }));

            // Every 5 minutes, check to see if the bot is still up.
            this.pingInterval = setInterval(() => {
                this.ws.send(JSON.stringify({
                    type: "PING",
                    jwt,
                    to: `BOT-${this.channelId}`
                }));

                this.pingReceived = false;

                // If pong isn't returned within 30 seconds, set bot state to sleeping and 
                setTimeout(() => {
                    if (!this.pingReceived) {
                        this.setState({botIsLive: false});
                    }
                }, 20 * 1000);
            }, 20 * 1000);
        }

        this.ws.onmessage = (message) => {
            let event = JSON.parse(message.data);

            // Refresh data based on event
            if (event.type === "CONTEXT") {
                if (event.data.shouldRefresh) {
                    this.getUser();
                }

                this.setState({
                    players: event.data.players,
                    monsters: event.data.monsters,
                    buffs: event.data.buffs,
                    cooldown: event.data.cooldown,
                    ready: this.state.user ? event.data.players.includes(this.state.user.name) : false,
                    botIsLive: true
                })
            } else if (event.type === "SHUTDOWN") {
                this.setState({botIsLive: false});
            } else if (event.type === "STARTUP") {
                this.setState({botIsLive: true});
            } else if (event.type === "PONG") {
                this.pingReceived = true;
                this.setState({botIsLive: true});
            }
        };

        this.ws.onclose = (e) => {
            console.log('Socket is closed. Reconnect will be attempted in 5 second.', e.reason);
            this.setState({ botIsLive: false });
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
            }
            setTimeout(() => {
                this.connect();
            }, 5000);
        };

        this.ws.onerror = (err) => {
            console.error('Socket encountered error: ', err.message, 'Closing socket');
            this.setState({ botIsLive: false, connecting: false, wsError: "Connection failed.  Bot is likely turned off right now." });
            ws.close();
        };
    }

    contextUpdate(context, delta) {
        if(delta.includes('theme')) {
            this.setState(() => {
                return {theme:context.theme}
            })
        }
    }

    visibilityChanged(isVisible) {
        this.setState(() => {
            return {
                isVisible
            }
        })
    }

    damageRange(user) {
        let tokens = user.equipment.hand.dmg.split("d");
        return {low: (tokens[0] * 1) + user.str, high: (tokens[0] * tokens[1]) + user.str};
    }

    getUser (callback) {
        let context = {};
        ApiHelper.getItemTable(this.jwt).then((itemTable) => {
            context["itemTable"] = itemTable;
            return ApiHelper.getJobTable(this.jwt);
        })
        .then((jobTable) => {
            context["jobTable"] = jobTable;
            return ApiHelper.getAbilityTable(this.jwt);
        })
        .then((abilityTable) => {
            context["abilityTable"] = abilityTable;
            this.context = context;
            return ApiHelper.getUser(this.userId, this.jwt);
        })
        .then((user) => {
            if (!user) {
                this.setState({hasBattler: false});
                if (callback) {
                    callback();
                }
                return;
            }

            user = ApiHelper.expandUser(user, context);
            this.setState({user, hasBattler: true});

            if (callback) {
                callback();
            }
        }).catch((e) => {
            this.setState({error: true, errorInfo: "This extension is currently unavailable"});
        });
    }

    componentDidMount(){
        if (this.twitch) {
            this.twitch.onAuthorized((auth) => {
                this.Authentication.setToken(auth.token, auth.userId)
                let userId = this.Authentication.getUserId();
                this.channelId = auth.channelId;
                this.jwt = auth.token;
                this.userId = userId;
                if(!this.state.finishedLoading){
                    this.getUser(() => {
                        this.connect();
                    });
                    
                    this.setState(() => {
                        return {
                            finishedLoading: true
                        }
                    });
                }
            })

            this.twitch.onVisibilityChanged((isVisible,_c) => {
                this.visibilityChanged(isVisible)
            })

            this.twitch.onContext((context,delta) => {
                this.contextUpdate(context,delta)
            })

            this.twitch.onVisibilityChanged((isVisible,_c) => {
                this.visibilityChanged(isVisible)
            })

            this.twitch.onContext((context,delta) => {
                this.contextUpdate(context,delta)
            })
        }
    }

    getTargets() {
        this.ws.send(JSON.stringify({
            type: "CONTEXT",
            jwt: this.jwt,
            to: `BOT-${this.channelId}`
        }));
    }

    onAttack(target) {
        this.ws.send(JSON.stringify({
            type: "COMMAND",
            jwt: this.jwt,
            to: `BOT-${this.channelId}`,
            message: `!attack ${target}`
        }));
    }

    onUseAbility(abilityId, target) {
        if (target === "ALL") {
            this.ws.send(JSON.stringify({
                type: "COMMAND",
                jwt: this.jwt,
                to: `BOT-${this.channelId}`,
                message: `!use ${abilityId}`
            }));
            return;
        }

        this.ws.send(JSON.stringify({
            type: "COMMAND",
            jwt: this.jwt,
            to: `BOT-${this.channelId}`,
            message: `!use ${abilityId} ${target}`
        }));
    }

    onUseItem(itemId, target) {
        if (target === "ALL") {
            this.ws.send(JSON.stringify({
                type: "COMMAND",
                jwt: this.jwt,
                to: `BOT-${this.channelId}`,
                message: `!use ${itemId}`
            }));
            return;
        }

        this.ws.send(JSON.stringify({
            type: "COMMAND",
            jwt: this.jwt,
            to: `BOT-${this.channelId}`,
            message: `!use ${itemId} ${target}`
        }));
    }

    onGiveItem(itemId, target) {
        this.ws.send(JSON.stringify({
            type: "COMMAND",
            jwt: this.jwt,
            to: `BOT-${this.channelId}`,
            message: `!give ${itemId} ${target}`
        }));
    }

    onExplore() {
        this.ws.send(JSON.stringify({
            type: "COMMAND",
            jwt: this.jwt,
            to: `BOT-${this.channelId}`,
            message: `!explore`
        }));
    }

    onAction(action, selection, target) {
        if (action === "attack") {
            this.onAttack(target);
        } else if (action === "ability") {
            this.onUseAbility(selection, target);
        } else if (action === "item") {
            this.onUseItem(`#${selection}`, target);
        } else if (action === "giveItem") {
            this.onGiveItem(selection, target);
        }
        this.setState({mode: "stats", action: "", selection: ""});
    }

    readyUp() {
        this.ws.send(JSON.stringify({
            type: "COMMAND",
            jwt: this.jwt,
            to: `BOT-${this.channelId}`,
            message: `!ready`
        }));
        this.setState({ready: true});
    }

    createBattler() {
        let userId = this.userId;
        let user = {
            userId
        };

        this.setState({connecting: true});

        axios.post(`https://deusprogrammer.com/api/ext/twitch/users`, user, {
            headers: {
                Authorization: `Bearer ${this.jwt}`
            }
        })
        .then(() => {
            this.setState({connecting: false});
            this.getUser(() => {
                this.ws.close();
            })
        });
    }
    
    render() {
        let earlyAccessNotice = <p><strong>NOTICE:</strong> Be aware that this is still in early access and may have bugs.  Your participation helps us perfect this system, until all Twitch Streamers can make use of it =).  Contact deusprogrammer@gmail.com for details if you are interested in using this on your channel.</p>
        let introText = "Welcome to Chat Battler Dungeon!  The multiuser dungeon and loot collection game for Twitch Chat!";

        if (!this.twitch.viewer.isLinked) {
            return (
                <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                    <div style={{textAlign: "center"}}>
                        <h4 style={{textAlign: "center"}}>Chat Battler Dungeon Ver 1.0.0b</h4>
                        <p>{introText}</p>
                        <p>In order to use this extension, you must allow us to see your twitch username.  Please click the button below and grant us access if you wish to create a battler and use this extension.</p>
                        <button onClick={() => {this.twitch.actions.requestIdShare()}}>Link User</button>
                        {earlyAccessNotice}
                    </div>
                </div>
            )
        }

        if (!this.state.hasBattler) {
            return (
                <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                    <div style={{textAlign: "center"}}>
                        <h4 style={{textAlign: "center"}}>Chat Battler Dungeon Ver 1.0.0b</h4>
                        <p>{introText}  You do not currently have a battler, however if you would like to participate in our stream battles, please click the button below.</p>
                        <button onClick={() => {this.createBattler()}} disabled={this.state.connecting}>Create a Battler</button>
                        {earlyAccessNotice}
                    </div>
                </div>
            )
        }

        if (this.state.error) {
            return (
                <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                    <div style={{textAlign: "center"}}>This panel is currently unavailable</div>
                </div>
            );
        }

        if (!this.state.botIsLive) {
            return (
                <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                    <div style={{textAlign: "center"}}>
                        <h4 style={{textAlign: "center"}}>Chat Battler Dungeon Ver 1.0.0b</h4>
                        <p>The bot is currently asleep.  Please come back during a stream.</p>
                        <p>If you believe the bot is awake, click below to refresh your connection.  It will take about 5 seconds for the connection to come back up.</p>
                        <button onClick={() => {this.setState({connecting: true}); this.ws.close();}} disabled={this.state.connecting}>Refresh</button>
                        {this.state.connecting ? <div>Refreshing connection to bot...</div> : null}
                        <div>{this.state.wsError}</div>
                    </div>
                </div>
            )
        }

        let user = this.state.user;

        if (!user) {
            return (
                <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                    <div style={{textAlign: "center"}}>Loading Battler...</div>
                </div>
            );
        }

        if (!this.state.ready) {
            return (
                <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                    <div style={{textAlign: "center"}}>
                        <h4 style={{textAlign: "center"}}>Chat Battler Dungeon Ver 1.0.0b</h4>
                        <p>Greetings, {user.name}, are you ready to enter the dungeon?  Currently, you are in a passive state where nothing can attack you.  Clicking the below button will put you in active state until you are idle for at least 10 minutes.</p>
                        <button type="button" onClick={() => {this.readyUp()}}>Enter the Dungeon</button>
                        {earlyAccessNotice}
                    </div>
                </div>
            )
        }

        if(this.state.finishedLoading && this.state.isVisible){
            return (
                <div className="App">
                    { this.state.mode === "stats" ?
                        <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                            <div style={{textAlign: "center"}}>
                                <h3 style={{textAlign: "center"}}>Stats</h3>
                                <div style={{display: "table", margin: "auto"}}>
                                    <div title="Your health points determine whether you are alive or not.  Once you hit zero, it's over." style={{cursor: "pointer", display: "table-row"}}>
                                        <div style={{background: "teal", fontWeight: "bolder", display: "table-cell", borderBottom: "1px solid black"}}>HP</div>
                                        <div style={{display: "table-cell", verticalAlign: "middle"}}> 
                                            <div style={{position: "relative", width: "100%"}}>
                                                <div style={{textAlign: "center", width: "100%", position: "absolute", top: "0px", left: "0px"}}>{user.hp}/{user.maxHp}</div>
                                                <div style={{backgroundColor: "red", width: "100px", height: "18px", padding: "0px", margin: "0px", border: "1px solid white"}}>
                                                    <div style={{backgroundColor: "green", width: `${user.hp/user.maxHp * 100}px`, height: "18px", padding: "0px", margin: "0px"}}></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div title="Your action points are consumed when you perform actions like attacking or using abilities." style={{cursor: "pointer", display: "table-row"}}>
                                        <div style={{background: "teal", fontWeight: "bolder", display: "table-cell", borderBottom: "1px solid black"}}>AP</div>
                                        <div style={{textAlign: "center", display: "table-cell"}}>{user.ap}</div>
                                    </div>
                                    <div title="This is the range of damage you can do with your current weapon." style={{cursor: "pointer", display: "table-row"}}>
                                        <div style={{background: "teal", fontWeight: "bolder", display: "table-cell"}}>Damage Range</div>
                                        <div style={{textAlign: "center", display: "table-cell"}}>{this.damageRange(user).low} - {this.damageRange(user).high}</div>
                                    </div>
                                </div>
                                <div style={{fontSize: "10px", textAlign: "center", paddingTop: "10px"}}>
                                    <span><b>STR:</b> {user.str} | <b>DEX:</b> {user.dex} | <b>INT:</b> {user.int} | <b>HIT:</b> {user.hit} | <b>AC:</b> {user.totalAC}</span>
                                </div>
                                <h3>Actions</h3>
                                <div style={{textAlign: "center"}}>
                                    <button title="Attack a foe with your currently equipped weapon" style={{width: "100px"}} onClick={() => {this.setState({mode: "targets", action: "attack", selection: {area: "ONE", target: "ANY"}})}}>Attack</button>
                                    <button title="Use an ability" style={{width: "100px"}} onClick={() => {this.setState({mode: "ability"})}}>Ability</button><br/>
                                    <button title="Look at or use items" style={{width: "100px"}} onClick={() => {this.setState({mode: "items"})}}>Items</button>
                                    <button title="Explore the dungeon and look for trouble" style={{width: "100px"}} onClick={() => {this.onExplore()}}>Explore</button>
                                </div>
                            </div>
                        </div> : null
                    }
                    { this.state.mode === "items" ?
                        <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                            <div>
                                <h3 style={{textAlign: "center"}}>Inventory</h3>
                                <div style={{fontSize: "12px"}}>
                                    <div style={{textAlign: "center", fontSize: "12px", backgroundColor: "gray"}}>Weapons</div>
                                    { user.inventory.filter(item => item.type === "weapon").map((item, index) => {
                                        return (
                                            <div style={{display: "table-row"}}>
                                                <div title={item.description} style={{display: "table-cell", width: "200px", padding: "5px"}}>{item.name}</div>
                                                <div style={{display: "table-cell", padding: "5px"}}><span style={{cursor: "pointer"}}>Equip</span></div>
                                                <div style={{display: "table-cell", padding: "5px"}}><span style={{cursor: "pointer"}}>Give</span></div>
                                            </div>
                                        )
                                    })}
                                    <div style={{textAlign: "center", fontSize: "12px", backgroundColor: "gray"}}>Armors</div>
                                    { user.inventory.filter(item => item.type === "armor").map((item, index) => {
                                        return (
                                            <div style={{display: "table-row"}}>
                                                <div title={item.description} style={{display: "table-cell", width: "200px", padding: "5px"}}>{item.name}</div>
                                                <div style={{display: "table-cell", padding: "5px"}}><span style={{cursor: "pointer"}}>Equip</span></div>
                                                <div style={{display: "table-cell", padding: "5px"}}><span style={{cursor: "pointer"}}>Give</span></div>
                                            </div>
                                        )
                                    })}
                                    <div style={{textAlign: "center", fontSize: "12px", backgroundColor: "gray"}}>Items</div>
                                    { user.inventory.filter(item => item.type === "consumable").map((item, index) => {
                                        return (
                                            <div style={{display: "table-row"}}>
                                                <div title={item.description} style={{display: "table-cell", width: "200px", padding: "5px"}}>{item.name}</div>
                                                <div style={{display: "table-cell", padding: "5px"}}><span style={{cursor: "pointer", backgroundColor: "green", border: "1px solid white", padding: "2px"}} onClick={() => {this.setState({mode: "targets", action: "item", selection: {id: item.id, area: "ONE", target: "CHAT"}})}}>Use</span></div>
                                                <div style={{display: "table-cell", padding: "5px"}}><span style={{cursor: "pointer", backgroundColor: "green", border: "1px solid white", padding: "2px"}} onClick={() => {this.setState({mode: "targets", action: "giveItem", selection: {id: item.id, area: "ONE", target: "CHAT"}})}}>Give</span></div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                            <hr/>
                        </div> : null
                    }
                    { this.state.mode === "attack" ?
                        <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                            <div>
                                <h3 style={{textAlign: "center"}}>Attack</h3>
                                <div style={{textAlign: "center", fontSize: "12px", backgroundColor: "gray"}}>Player Targets</div>
                                {this.state.players.map((player) => {
                                    if (player !== this.state.user.name) {
                                        return <button onClick={() => {this.setState({mode: "targets", action: "attack"})}}>{player}</button>
                                    }
                                })}
                                <div style={{textAlign: "center", fontSize: "12px", backgroundColor: "gray"}}>Monster Targets</div>
                                {this.state.monsters.map((monster) => {
                                    return <button onClick={() => {this.setState({mode: "targets", action: "attack"})}}>{monster}</button>
                                })}
                            </div>
                        </div> : null
                    }
                    { this.state.mode === "ability" ?
                        <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                            <div>
                                <h3 style={{textAlign: "center"}}>Abilities</h3>
                                {user.abilities.length > 0 ?
                                    <React.Fragment>
                                        <div style={{fontSize: "12px", backgroundColor: "gray"}}>Attack Abilities</div>
                                        { user.abilities.filter(ability => ability.element !== "HEALING" && ability.element !== "BUFFING").map((ability) => {
                                            return (
                                                <button title={ability.description} key={`${ability.id}`} style={{fontSize: "10px"}} onClick={() => {this.setState({mode: "targets", action: "ability", selection: ability})}}>{ability.name}</button>
                                            )
                                        })}
                                        <div style={{fontSize: "12px", backgroundColor: "gray"}}>Healing Abilities</div>
                                        { user.abilities.filter(ability => ability.element === "HEALING").map((ability) => {
                                            return (
                                                <button title={ability.description} key={`${ability.id}`} style={{fontSize: "10px"}} onClick={() => {this.setState({mode: "targets", action: "ability", selection: ability})}}>{ability.name}</button>
                                            )
                                        })}
                                        <div style={{fontSize: "12px", backgroundColor: "gray"}}>Buff Abilities</div>
                                        { user.abilities.filter(ability => ability.element === "BUFFING").map((ability) => {
                                            return (
                                                <button title={ability.description} key={`${ability.id}`} style={{fontSize: "10px"}} onClick={() => {this.setState({mode: "targets", action: "ability", selection: ability})}}>{ability.name}</button>
                                            )
                                        })}
                                    </React.Fragment> : null 
                                }
                            </div>
                            <hr/>
                        </div> : null
                    }
                    { this.state.mode === "targets" ?
                        <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} >
                            <h3 style={{textAlign: "center"}}>Select a Target</h3>
                            <div style={{textAlign: "center", fontSize: "12px", backgroundColor: "gray"}}>Player Targets</div>
                            {this.state.selection.area !== "ALL" && ["ANY", "CHAT"].includes(this.state.selection.target) ?
                                <React.Fragment>
                                    {this.state.players.map((player) => {
                                        if (player === this.state.user.name) {
                                            return
                                        }
                                        return <button onClick={() => {this.onAction(this.state.action, this.state.selection.id, player)}}>{player}</button>
                                    })}
                                    <button onClick={() => {this.onAction(this.state.action, this.state.selection.id, this.state.user.name)}}>Yourself</button>
                                </React.Fragment> : null
                            }
                            {this.state.selection.area === "ALL" && ["ANY", "CHAT"].includes(this.state.selection.target) ?
                                <button onClick={() => {this.onAction(this.state.action, this.state.selection.id, "ALL")}}>All Players</button> : null
                            }
                            <div style={{textAlign: "center", fontSize: "12px", backgroundColor: "gray"}}>Monster Targets</div>
                            {this.state.selection.area !== "ALL" && ["ANY", "ENEMY"].includes(this.state.selection.target) ?
                                <React.Fragment>
                                    {this.state.monsters.map((monster) => {
                                        return <button onClick={() => {this.onAction(this.state.action, this.state.selection.id, monster)}}>{monster}</button>
                                    })}
                                </React.Fragment> : null
                            }
                            {this.state.selection.area === "ALL" && ["ANY", "ENEMY"].includes(this.state.selection.target) ?
                                <button onClick={() => {this.onAction(this.state.action, this.state.selection.id, "ALL")}}>All Enemies</button> : null
                            }
                        </div> : null
                    }
                    { this.state.mode !== "stats" ?
                        <div className={this.state.theme === 'light' ? 'App-light' : 'App-dark'} style={{textAlign: "center"}} >
                            <p>Hover over abilities and items for a description.</p>
                            <button onClick={() => {this.setState({mode: "stats", action: "", selection: ""})}}>Back</button>
                        </div>
                    : null}
                </div>
            )
        } else {
            return (
                <div className="App">
                </div>
            )
        }

    }
}