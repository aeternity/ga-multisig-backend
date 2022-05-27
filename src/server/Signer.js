const {DataTypes} = require('sequelize');
const {sequelize} = require('./db')

const Signer = sequelize.define('Signer', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  signerId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  contractId: {
    type: DataTypes.STRING,
    allowNull: false
  },
});

module.exports = Signer;
