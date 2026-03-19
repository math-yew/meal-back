require('dotenv').config();
const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');

const app = express();
const port = process.env.PORT || 8080;

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
        rejectUnauthorized: true, // TiDB Cloud works best with this
      }
    }
  }
);

// 2. Define a "Hello World" Model
const Message = sequelize.define('Message', {
  text: DataTypes.STRING
});

// 3. Simple Route to test everything
app.get('/', async (req, res) => {
  try {
    // Sync table, Create a row, and Fetch it
    await sequelize.sync(); 
    await Message.create({ text: "Hello from TiDB!" });
    const lastMessage = await Message.findOne({ order: [['createdAt', 'DESC']] });
    
    res.json({
      status: "Success!",
      database_message: lastMessage.text,
      timestamp: new Date()
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Database connection failed: " + error.message);
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});