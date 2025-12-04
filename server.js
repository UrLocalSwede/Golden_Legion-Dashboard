const express = require('express');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 3000;

app.use(express.static("public"));

const API_KEY = process.env.HypixelApiKey;

// --- Persistent cache setup ---
const cacheFile = './cache.json';

// Load cache from disk on startup
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

// Helper to save cache to disk
function saveCache() {
    try {
        const obj = Object.fromEntries(uuidCache);
        fs.writeFileSync(cacheFile, JSON.stringify(obj, null, 2));
    } catch (err) {
        console.error('Error saving cache:', err.message);
    }
}

// Helper to get username from UUID with cache
async function getUsernameFromUUID(uuid) {
    if (uuidCache.has(uuid)) return uuidCache.get(uuid);

    try {
        const response = await axios.get(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
        const username = response.data.name;

        uuidCache.set(uuid, username);
        saveCache(); // Save immediately

        return username;
    } catch (err) {
        console.error(`Failed to fetch username for ${uuid}:`, err.message);
        return uuid; // fallback to UUID if API fails
    }
}

// --- Routes ---
app.get('/', (req, res) => {
    res.send('Website Running...');
});

app.get("/guild/:name", async (req, res) => {
    const guildName = req.params.name;

    try {
        const response = await axios.get(
            `https://api.hypixel.net/v2/guild?name=${guildName}&key=${API_KEY}`
        );

        const guild = response.data.guild;

        if (!guild) return res.json({ guild: null });

        // Convert UUIDs to usernames with persistent cache
        const membersWithNames = await Promise.all(
            guild.members.map(async member => {
                const username = await getUsernameFromUUID(member.uuid);
                return { ...member, username };
            })
        );

        res.json({
            guild: {
                ...guild,
                members: membersWithNames
            }
        });

    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// --- Start server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
