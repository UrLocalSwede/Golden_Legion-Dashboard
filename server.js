const express = require('express');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 3000;

app.use(express.static("public"));

const API_KEY = process.env.HypixelApiKey;

// --- Persistent username cache ---
const cacheFile = './cache.json';
let uuidCache = new Map();

if (fs.existsSync(cacheFile)) {
    try {
        const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        uuidCache = new Map(Object.entries(data));
        console.log(`Loaded ${uuidCache.size} cached usernames.`);
    } catch (err) {
        console.error('Error reading cache file:', err.message);
    }
}

function saveCache() {
    try {
        fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(uuidCache), null, 2));
    } catch (err) {
        console.error('Error saving cache:', err.message);
    }
}

async function getUsernameFromUUID(uuid) {
    if (uuidCache.has(uuid)) return uuidCache.get(uuid);

    try {
        const res = await axios.get(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
        const username = res.data.name;
        uuidCache.set(uuid, username);
        saveCache();
        return username;
    } catch (err) {
        console.error(`Failed to fetch username for ${uuid}:`, err.message);
        return uuid; // fallback
    }
}

// --- Online status check ---
async function getPlayerStatus(uuid) {
    try {
        const res = await axios.get(`https://api.hypixel.net/player?key=${API_KEY}&uuid=${uuid}`);
        const player = res.data.player;
        if (!player) return false;
        return player.lastLogin && (!player.lastLogout || player.lastLogin > player.lastLogout);
    } catch (err) {
        console.error(`Failed to fetch status for ${uuid}:`, err.message);
        return false;
    }
}

// --- Get guild members ---
async function getGuildMembers() {
    try {
        const res = await axios.get(`https://api.hypixel.net/guild?name=Golden Legion&key=${API_KEY}`);
        const guild = res.data.guild;
        if (!guild) return [];

        return await Promise.all(
            guild.members.map(async (member) => {
                const username = await getUsernameFromUUID(member.uuid);
                return {
                    uuid: member.uuid,
                    username,
                    rank: member.rank || "Member"
                };
            })
        );
    } catch (err) {
        console.error('Error fetching guild members:', err.message);
        return [];
    }
}

// --- Routes ---
app.get('/', (req, res) => {
    res.send('Website Running...');
});

app.get('/guild-members', async (req, res) => {
    try {
        const guildMembers = await getGuildMembers();
        const membersWithStatus = await Promise.all(
            guildMembers.map(async (member) => {
                const online = await getPlayerStatus(member.uuid);
                return { ...member, online };
            })
        );
        res.json(membersWithStatus);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching members');
    }
});

// --- Start server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
