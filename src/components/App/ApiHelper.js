import axios from 'axios';
import config from './config';

// Just for initial testing

const indexArrayToMap = (array) => {
    let table = {};
    array.forEach((element) => {
        table[element.id] = element;
    });

    return table;
}

const recalculateStats = (userData) => {
    userData.totalAC = 0;
    Object.keys(userData.equipment).forEach((slot) => {
        let item = userData.equipment[slot];
        if (item.type === "armor") {
            userData.totalAC += item.ac;
        }
    });

    return userData;
}

const getUser = (username, token) => {
    return axios.get(`${config.BASE_URL}/users/${username}`, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    })
    .then((response) => {
        return response.data;
    }).catch((err) => {
        if (err.response && err.response.status === 404) {
            return null;
        } else {
            throw err;
        }
    });
}

const getItemTable = (token) => {
    return axios.get(`${config.BASE_URL}/items`, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    })
    .then((response) => {
        return indexArrayToMap(response.data);
    });
}

const getJobTable = (token) => {
    return axios.get(`${config.BASE_URL}/jobs`, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    })
    .then((response) => {
        return indexArrayToMap(response.data);
    });
}

const getAbilityTable = (token) => {
    return axios.get(`${config.BASE_URL}/abilities`, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    })
    .then((response) => {
        return indexArrayToMap(response.data);
    })
}

const expandUser = (userData, context) => {
    userData.totalAC = 0;
    userData.abilities = [];
    userData.currentJob = context.jobTable[userData.currentJob.id];
    userData.str = userData.currentJob.str;
    userData.dex = userData.currentJob.dex;
    userData.int = userData.currentJob.int;
    userData.hit = userData.currentJob.hit;
    userData.maxHp = userData.currentJob.hp;
    Object.keys(userData.equipment).forEach((slot) => {
        let item = userData.equipment[slot];
        let itemData = context.itemTable[item.id];
        if (itemData.type === "armor") {
            userData.totalAC += itemData.ac;
        }
        userData.totalAC += itemData.mods.ac;
        userData.maxHp += itemData.mods.hp;
        userData.str += itemData.mods.str;
        userData.dex += itemData.mods.dex;
        userData.int += itemData.mods.int;
        userData.hit += itemData.mods.hit;
        itemData.abilities.forEach((ability) => {
            if (userData.abilities.find((element) => {
                return ability === element.id
            })) {
                return;
            }
            userData.abilities.push(context.abilityTable[ability]);
        });
        userData.equipment[slot] = itemData;
    });
    let newInventoryList = [];
    userData.inventory.forEach((item) => {
        newInventoryList.push(context.itemTable[item]);
    });

    if (userData.maxHp < 0) {
        userData.maxHp = 1;
    }

    if (userData.hp > userData.maxHp) {
        userData.hp = userData.maxHp;
    }

    userData.inventory = newInventoryList;
    userData.actionCooldown = Math.min(11, 6 - Math.min(5, userData.dex));

    return userData;
}

export default {
    expandUser,
    recalculateStats,
    getUser,
    getItemTable,
    getAbilityTable,
    getJobTable
}