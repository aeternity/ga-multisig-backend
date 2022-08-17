const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Tx = sequelize.define('Tx', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  hash: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  data: {
    type: DataTypes.STRING,
    allowNull: false,
  },
});

module.exports = Tx;
