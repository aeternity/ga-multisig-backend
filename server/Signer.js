const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Signer = sequelize.define(
  'Signer',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    signerId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    contractId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    gaAccountId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    height: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    indexes: [
      {
        unique: true,
        fields: ['signerId', 'contractId'],
      },
    ],
  },
);

module.exports = Signer;
