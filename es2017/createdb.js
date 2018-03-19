"use strict";
const editEnv = require("edit-dotenv");
const Enquirer = require("enquirer");
const isset = require("isset");
const knex = require("knex");
const {outputFile, readFile}= require("fs-extra");
const {parse:parseEnv} = require("dotenv");



// TODO :: try https://npmjs.com/pgtools ?

const createdb = async (envPath=".env", envSamplePath=".env.sample") =>
{
	const envs = await Promise.all(
	[
		readEnv(envPath),
		readEnv(envSamplePath)
	]);

	const envString = envs[0] || envs[1];
	const env = await parseEnv(envString);
	const changes = await prompts(env);

	if (Object.keys(changes).length > 0)
	{
		Object.assign(env, changes);

		await outputFile(envPath, editEnv(envString, changes));
	}
	else if (envString === envs[1])
	{
		// Duplicate the sample
		await outputFile(envPath, envString);
	}

	return db(env);
};



const db = async env =>
{
	const host     = env.POSTGRES_HOST;
	const port     = env.POSTGRES_PORT;
	const user     = env.POSTGRES_USER;
	const password = env.POSTGRES_PASSWORD;

	const db       = env.NEW_DB;
	const newUser  = env.NEW_USER;
	const newPassword = env.NEW_PASSWORD;

	if (!isset(host) || !isset(db) || !isset(password) || !isset(user))
	{
		throw new Error("Environmental variable(s) not set");
	}

	const psql = knex({
		client: 'pg',
		connection: { host, user, password, port, database: 'postgres' },
		debug: false,
	});

	try
	{
		console.info("creating database", db);
		await psql.raw("create database ??", db);

		await psql.transaction(async trx =>
		{
			// Passwords within "create user" are specifically disallowed parameters in PostgreSQL
			console.info("creating new user", newUser)
			const query = trx.raw("create user ?? with encrypted password ?", [newUser, newPassword]).toString();

			await trx.raw(query);
			console.info("revoking public connect permissions for new database..")
			await trx.raw("revoke connect on database ?? from public", db);
			console.info("granting permissions on new database for new user..")
			await trx.raw("grant all on database ?? to ??", [db, newUser]);
		});

		console.info("database transaction complete")

		psql.destroy();

		return {
			HOST: host,
			PORT: port,
			DB: db,
			USER: newUser,
			PASSWORD: newPassword,
		}
	}
	catch (error)
	{
		psql.destroy();
		throw error;
	}
};



const prompts = async env =>
{
	const enquirer = new Enquirer();

	const promptVars =
	[
		"POSTGRES_HOST",
		"POSTGRES_PORT",
		"POSTGRES_USER",
		"POSTGRES_PASSWORD",
		"NEW_DB",
		"NEW_USER",
		"NEW_PASSWORD",
	];

	// TODO :: also prompt for SUPERUSER_NAME and SUPERUSER_PASSWORD (https://github.com/brianc/node-postgres/wiki/Client#new-clientobject-config--client)

	const questions = promptVars.map(varname => enquirer.question(
	{
		name: varname,
		message: `Value for ${varname}`,
		default: isset(env[varname]) ? env[varname] : ""
	}));

	const answers = await enquirer.ask(questions);

	return Object.keys(answers).reduce((result, varname) =>
	{
		if (varname in env && answers[varname]===env[varname])
		{
			delete answers[varname];
		}

		return result;
	}, answers);
};



const readEnv = async path =>
{
	try
	{
		return await readFile(path, "utf8");
	}
	catch (error)
	{
		if (error.code === "ENOENT")
		{
			return "";
		}
		else
		{
			throw error;
		}
	}
};



module.exports = createdb;
