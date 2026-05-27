const express = require('express');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');

module.exports = function(User) {
    const router = express.Router();

    // 1. Configure Passport Local Strategy
    // We use 'email' as the username field
    passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
        try {
            const user = await User.findOne({ where: { email } });
            if (!user) return done(null, false, { message: 'User not found.' });

            const match = await bcrypt.compare(password, user.password);
            if (!match) return done(null, false, { message: 'Incorrect password.' });

            return done(null, user);
        } catch (err) {
            return done(err);
        }
    }));

    // 2. Serialize / Deserialize (How Passport stores the user in the session cookie)
    passport.serializeUser((user, done) => done(null, user.id));
    
    passport.deserializeUser(async (id, done) => {
        try {
            const user = await User.findByPk(id, { attributes: ['id', 'username', 'email'] });
            done(null, user);
        } catch (err) {
            done(err);
        }
    });

    // 3. Register Route
    router.post('/register', async (req, res) => {
        try {
            const { username, email, password } = req.body;
            
            // Hash password with a salt round of 10
            const hashedPassword = await bcrypt.hash(password, 10);
            
            const newUser = await User.create({ 
                username, 
                email, 
                password: hashedPassword 
            });

            // Automatically log them in after registering
            req.login(newUser, (err) => {
                if (err) throw err;
                res.json({ id: newUser.id, username: newUser.username });
            });
        } catch (err) {
            res.status(400).json({ error: "Email might already be in use." });
        }
    });

    // 4. Login Route
    router.post('/login', passport.authenticate('local'), (req, res) => {
        // If passport.authenticate succeeds, it reaches this function
        res.json({ id: req.user.id, username: req.user.username });
    });

    // 5. Logout Route
    router.post('/logout', (req, res) => {
        req.logout((err) => {
            if (err) return res.status(500).json({ error: "Error logging out" });
            res.json({ message: "Logged out" });
        });
    });

    // 6. Check Session Route (Used by React to see if you are already logged in)
    router.get('/me', (req, res) => {
        if (req.isAuthenticated()) {
            res.json(req.user);
        } else {
            res.status(401).json({ error: "Not authenticated" });
        }
    });

    return { router, passport };
};