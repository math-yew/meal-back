require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { Sequelize, DataTypes } = require('sequelize');

const setupAuth = require('./auth'); 
const port = process.env.PORT || 8080;
const app = express();
const path = require('path');

app.use(cors({
    origin: ['http://127.0.0.1:3000','http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

// 1. Setup Sequelize Connection to TiDB
const sequelize = new Sequelize(
  process.env.TIDB_DB_NAME || 'test',
  process.env.TIDB_USER,
  process.env.TIDB_PASSWORD,
  {
    host: process.env.TIDB_HOST,
    port: 4000,
    dialect: 'mysql',
    dialectOptions: {
      ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true 
      }
    }
  }
);

const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false }
}, { tableName: 'users', timestamps: false });

// Recipe Model
const Recipe = sequelize.define('Recipe', {
  title: { type: DataTypes.STRING, allowNull: false },
  instructions: DataTypes.TEXT,
  cooking_time_minutes: DataTypes.INTEGER,
  servings: DataTypes.INTEGER
}, { tableName: 'recipes', underscored: true, timestamps: false });

// Ingredient Model
const Ingredient = sequelize.define('Ingredient', {
  name: { type: DataTypes.STRING, unique: true, allowNull: false }
}, { tableName: 'ingredients', timestamps: false });

// Junction Table with extra fields
const RecipeIngredient = sequelize.define('RecipeIngredient', {
  amount: DataTypes.DECIMAL(10, 2),
  unit: DataTypes.STRING
}, { tableName: 'recipe_ingredients', timestamps: false });

// Associations
Recipe.belongsToMany(Ingredient, { through: RecipeIngredient, foreignKey: 'recipe_id' });
Ingredient.belongsToMany(Recipe, { through: RecipeIngredient, foreignKey: 'ingredient_id' });
User.hasMany(Recipe, { foreignKey: 'user_id' });
Recipe.belongsTo(User, { foreignKey: 'user_id' });

// Initialize Auth
const { router: authRouter, passport } = setupAuth(User);
app.use(passport.initialize());
app.use(passport.session());
app.use('/auth', authRouter); // Mount auth routes

const requireAuth = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next(); // User is logged in, proceed to the route
    }
    res.status(401).json({ error: "You must be logged in to do that." });
};

app.use(express.json()); // Essential for parsing POST/PUT bodies

app.get('/recipes', requireAuth, async (req, res) => {
    try {
        const recipes = await Recipe.findAll({
            where: { user_id: req.user.id }, // <--- The magic filter
            order: [['created_at', 'DESC']]
        });
        res.json(recipes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET SINGLE RECIPE (Must belong to user)
app.get('/recipes/:id', requireAuth, async (req, res) => {
    try {
        const recipe = await Recipe.findOne({
            where: { 
                id: req.params.id, 
                user_id: req.user.id // Prevents viewing other people's recipes
            },
            include: [{
                model: Ingredient,
                through: { attributes: ['amount', 'unit'] }
            }]
        });
        if (!recipe) return res.status(404).json({ error: "Recipe not found" });
        res.json(recipe);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE NEW RECIPE
app.post('/recipes', requireAuth, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { title, instructions, cooking_time_minutes, servings, ingredients } = req.body;
        
        // Inject the user_id into the new recipe
        const recipe = await Recipe.create({
            title, 
            instructions, 
            cooking_time_minutes, 
            servings,
            user_id: req.user.id // <--- Assign ownership
        }, { transaction: t });

        if (ingredients && ingredients.length > 0) {
            for (const item of ingredients) {
                const [ingredient] = await Ingredient.findOrCreate({
                    where: { name: item.name },
                    transaction: t
                });
                await RecipeIngredient.create({
                    recipe_id: recipe.id,
                    ingredient_id: ingredient.id,
                    amount: item.amount,
                    unit: item.unit
                }, { transaction: t });
            }
        }
        await t.commit();
        res.status(201).json(recipe);
    } catch (err) {
        await t.rollback();
        res.status(500).json({ error: err.message });
    }
});

// UPDATE RECIPE
app.put('/recipes/:id', requireAuth, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { title, instructions, cooking_time_minutes, servings, ingredients } = req.body;
        
        // Find recipe AND ensure it belongs to the user
        const recipe = await Recipe.findOne({ 
            where: { id: req.params.id, user_id: req.user.id } 
        });
        
        if (!recipe) return res.status(404).json({ error: "Recipe not found or unauthorized" });

        await recipe.update({ title, instructions, cooking_time_minutes, servings }, { transaction: t });

        if (ingredients) {
            await RecipeIngredient.destroy({ where: { recipe_id: recipe.id }, transaction: t });
            
            for (const item of ingredients) {
                const [ingredient] = await Ingredient.findOrCreate({
                    where: { name: item.name },
                    transaction: t
                });

                await RecipeIngredient.create({
                    recipe_id: recipe.id,
                    ingredient_id: ingredient.id,
                    amount: item.amount,
                    unit: item.unit
                }, { transaction: t });
            }
        }

        await t.commit();
        res.json({ message: "Updated successfully" });
    } catch (err) {
        await t.rollback();
        res.status(500).json({ error: err.message });
    }
});

// DELETE RECIPE
app.delete('/recipes/:id', requireAuth, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        // Find recipe AND ensure it belongs to the user before deleting
        const recipe = await Recipe.findOne({ 
            where: { id: req.params.id, user_id: req.user.id } 
        });

        if (!recipe) return res.status(404).json({ error: "Recipe not found or unauthorized" });

        await RecipeIngredient.destroy({ where: { recipe_id: recipe.id }, transaction: t });
        await recipe.destroy({ transaction: t });

        await t.commit();
        res.json({ message: "Recipe deleted" });
    } catch (err) {
        await t.rollback();
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});