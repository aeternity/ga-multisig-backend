const { Sequelize } = require('sequelize');

async function up({ context: queryInterface }) {
  await queryInterface.bulkDelete('Signers', null, {
    truncate: true,
    cascade: true,
  });
}

async function down({ context: queryInterface }) {
  await queryInterface.dropTable('users');
}

module.exports = { up, down };
