const express = require('express');
const axios = require('axios');
const fs = require('fs');


require('dotenv').config();

const db = require("./database");

const app = express();
const session = require("express-session");

const PORT = 8020;

app.use(express.static("public"));

const API_KEY = process.env.HypixelApiKey;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:8020/auth/discord/callback";

app.use(session({
    secret: "MattIsHandsome",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

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
        return uuid;
    }
}

// --- Online status & store rank cache (updated every 20 minutes) ---
let onlineStatusCache = new Map(); // uuid => { online: bool, storeRank: string }
let lastOnlineUpdate = 0;
const ONLINE_UPDATE_INTERVAL = 20 * 60 * 1000; // 20 minutes

async function updateOnlineStatus(guildMembers) {
    const now = Date.now();
    if (now - lastOnlineUpdate < ONLINE_UPDATE_INTERVAL) return;

    console.log('Updating online status & store rank cache...');
    await Promise.all(
        guildMembers.map(async (member) => {
            try {
                const res = await axios.get(`https://api.hypixel.net/player?key=${API_KEY}&uuid=${member.uuid}`);
                const player = res.data.player;

                const online = player && player.lastLogin && (!player.lastLogout || player.lastLogin > player.lastLogout);
                const storeRank = player?.rank || player?.newPackageRank || player?.packageRank || "Member";

                onlineStatusCache.set(member.uuid, { online, storeRank });
            } catch (err) {
                console.error(`Failed to fetch status for ${member.uuid}:`, err.message);
                onlineStatusCache.set(member.uuid, { online: false, storeRank: "Member" });
            }
        })
    );

    lastOnlineUpdate = Date.now();
    console.log(`Online status & store rank cache updated at: ${new Date(lastOnlineUpdate).toLocaleString()}`);
}

// --- Fetch guild members with usernames ---
async function getGuildMembers() {
    try {
        const res = await axios.get(`https://api.hypixel.net/guild?name=Golden%20Legion&key=${API_KEY}`);
        const guild = res.data.guild;
        if (!guild) return [];

        const members = await Promise.all(
            guild.members.map(async (member) => {
                const username = await getUsernameFromUUID(member.uuid);
                return {
                    uuid: member.uuid,
                    username,
                    rank: member.rank || "Member"
                };
            })
        );

        // Update online status & store rank asynchronously
        updateOnlineStatus(members).catch(console.error);

        return members;
    } catch (err) {
        console.error('Error fetching guild members:', err.message);
        return [];
    }
}

function requireLogin(req, res, next) {
    if (!req.session.user) return res.status(401).send("Nope");
    next();
}

// --- Routes ---
app.get('/', (req, res) => {
    res.send('Website Running...');
});

// Guild info with online & store rank
app.get("/guild/:name", async (req, res) => {
    try {
        const response = await axios.get(`https://api.hypixel.net/v2/guild?name=${req.params.name}&key=${API_KEY}`);
        const guild = response.data.guild;
        if (!guild) return res.json({ guild: null });

        const membersWithInfo = await Promise.all(
            guild.members.map(async (member) => {
                const username = await getUsernameFromUUID(member.uuid);
                const cached = onlineStatusCache.get(member.uuid) || { online: false, storeRank: "Member" };
                return { ...member, username, ...cached };
            })
        );

        res.json({ guild: { ...guild, members: membersWithInfo } });
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data || err.message });
    }
});

// Full guild members list
app.get('/guild-members', async (req, res) => {
    try {
        const guildMembers = await getGuildMembers();

        const membersWithInfo = guildMembers.map(member => {
            const cached = onlineStatusCache.get(member.uuid) || { online: false, storeRank: "Member" };
            return { ...member, ...cached };
        });

        res.json(membersWithInfo);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching members');
    }
});

// Force online & store rank update
app.get('/update-online', async (req, res) => {
    try {
        const guildMembers = await getGuildMembers();
        await Promise.all(
            guildMembers.map(async (member) => {
                try {
                    const res = await axios.get(`https://api.hypixel.net/player?key=${API_KEY}&uuid=${member.uuid}`);
                    const player = res.data.player;
                    const online = player && player.lastLogin && (!player.lastLogout || player.lastLogin > player.lastLogout);
                    const storeRank = player?.rank || player?.newPackageRank || player?.packageRank || "Member";
                    onlineStatusCache.set(member.uuid, { online, storeRank });
                } catch (err) {
                    console.error(`Failed to fetch status for ${member.uuid}:`, err.message);
                    onlineStatusCache.set(member.uuid, { online: false, storeRank: "Member" });
                }
            })
        );

        lastOnlineUpdate = Date.now();
        res.send('Online status & store rank manually updated!');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update online status');
    }
});

app.get("/auth/discord", (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;

    res.redirect(url);
});

app.get("/auth/discord/callback", async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send("No code provided");

    try {
        // Get token
        const tokenRes = await axios.post(
            "https://discord.com/api/oauth2/token",
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: "authorization_code",
                code,
                redirect_uri: REDIRECT_URI
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        );

        const accessToken = tokenRes.data.access_token;

        // Get Discord user
        const userRes = await axios.get("https://discord.com/api/users/@me", {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const user = userRes.data;

        // SAVE TO DATABASE (this is the important part)
        db.run(
            `
            INSERT INTO users (id, username, avatar, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                avatar = excluded.avatar
            `,
            [
                user.id,
                user.username,
                user.avatar,
                Date.now()
            ]
        );

        console.log("Saved user:", user.username);

        req.session.user = {
            id: user.id,
            username: user.username,
            avatar: user.avatar
        };

        return res.redirect("/profile")

        res.send(`Welcome ${user.username}`);
    } catch (err) {
        console.error(err.response?.data || err.message);
        return res.send("Login failed");
    }
});

app.get("/profile", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/auth/discord");
    }

    res.send(`
        <h1>Welcome ${req.session.user.username}</h1>
        <img src="https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png" />
        <br>
        <a href="/logout">Logout</a>
    `);
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

app.get("/users", requireLogin, (req, res) => {
    db.all("SELECT * FROM users", [], (err, rows) => {
        if (err) return res.status(500).send(err.message);
        res.json(rows);
    });
});

// --- Start server ---
app.listen(PORT, () => {
    console.log(`Server is runnings on http://localhost:${PORT}`);
});
