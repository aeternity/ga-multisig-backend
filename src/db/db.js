const {Sequelize} = require('sequelize');

if (!process.env.PG_USER) throw new Error("PG_USER Environment Missing");
if (!process.env.PG_PASSWORD) throw new Error("PG_PASSWORD Environment Missing");
if (!process.env.PG_HOST) throw new Error("PG_HOST Environment Missing");
if (!process.env.PG_PORT) throw new Error("PG_PORT Environment Missing");
if (!process.env.PG_DB) throw new Error("PG_DB Environment Missing");

console.log("Initializing DB Connection")
console.log("PG_USER", process.env.PG_USER)
console.log("PG_HOST", process.env.PG_HOST)
console.log("PG_PORT", process.env.PG_PORT)
console.log("PG_DB", process.env.PG_DB)

const sequelize = new Sequelize(`postgres://${process.env.PG_USER}:${encodeURIComponent(process.env.PG_PASSWORD)}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DB}`);

module.exports = {
  sequelize,
};
