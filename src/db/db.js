const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.PG_CONNECTION_URI || 'postgres://postgres:postgres@localhost:5432/postgres');

module.exports = {
  sequelize,
};
