#!/usr/local/bin/node
const fs = require( "fs" );
const readlineSync = require( "readline-sync" );
const execSync = require( "child_process" ).execSync;

// We need to do this here because we want to create specific commands for executing commands in the monorepoLocation.
let monorepoLocation = get_monorepo_location_from_file();

// Create two commands that can be used for executing commands in the monorepoLocation.
const execMonorepo = cmd => execSync( cmd, { cwd: monorepoLocation } );
const execMonorepoNoOutput = cmd => execSync( cmd, { cwd: monorepoLocation, stdio: [ null, null, null ] } );

const NO_OUTPUT = { stdio: [ null, null, null ] };

/**
 * This function checks if the CI flag is set. If so, it returns either the TRAVIS_BRANCH or the TRAVIS_PULL_REQUEST_BRANCH.
 * Otherwise, this returns the currently checked out branch in the current directory.
 *
 * @returns {string} The checkoutBranch;
 */
function get_checkout_branch() {
	if ( process.env.CI === "1" ) {
		if ( process.env.TRAVIS_PULL_REQUEST_BRANCH ) {
			return process.env.TRAVIS_PULL_REQUEST_BRANCH;
		}
		return process.env.TRAVIS_BRANCH;
	}
	return get_current_branch();
}

/**
 * Gets the currently checked out branch for a git repository.
 *
 * @returns {string} The current branch.
 */
function get_current_branch() {
	return execSync( `git branch | grep \\* | cut -d " " -f2-` )
		.toString( "utf8" )
		.split( "\n" )[ 0 ];
}

/**
 * Gets the monorepo-location from the .yoast file or asks the user for a location if either the file does not exist or the right key is not there.
 * If a .yoast file exists but the key "monorepo-location" is not there, this function adds a new key to the file without overwriting existing values.
 *
 * @returns {string} The monorepo-location.
 */
function get_monorepo_location_from_file() {
	const yoastConfig = get_yoast_config();

	let location = yoastConfig[ "monorepo-location" ];

	if ( is_valid_monorepo_location( location ) ) {
		return location;
	}

	while ( ! is_valid_monorepo_location( location ) ) {
		console.log( "The location you've in your .yoast file or the location you've provided is not valid. Please provide a new location for your javascript clone." );
		location = readlineSync.question( "Where is your monorepo git clone located? Please provide an absolute path or a path relative to the current directory '" + process.cwd() + "'.\n" );
	}

	const newConfig = Object.assign( {}, yoastConfig, { location } );
	try {
		save_configuration( newConfig );
	} catch ( e ) {
		// Ignore not being able to write. Just return the location.
	}

	return location;
}

/**
 * Get the .yoast configuration contents.
 *
 * @returns {Object} The yoast configuration object.
 */
function get_yoast_config() {
	try {
		return JSON.parse( fs.readFileSync( ".yoast", "utf8" ) ) || {};
	} catch ( e ) {
		return {};
	}
}

/**
 * Saves the configuration to the configuration file.
 *
 * @param {Object} configuration The new configuration.
 *
 * @returns {void}
 */
function save_configuration( configuration ) {
	fs.writeFileSync( ".yoast", JSON.stringify( configuration ), "utf8" );
}


/**
 * Function to check if the given location is a valid location for the monorepo.
 *
 * @param {string} location The location that is checked.
 *
 * @returns {boolean} Returns true if the location exists and has a remote.origin.url that includes Yoast/javascript.
 */
function is_valid_monorepo_location( location ) {
	if ( ! location ) {
		return false;
	}

	if ( ! fs.existsSync( location ) ) {
		return false;
	}
	return execSync( `cd ${ location }; git config --get remote.origin.url;` ).includes( "Yoast/javascript" );

}

/**
 * Get the branch that we want to try and checkout on the monorepo.
 *
 * @param {string} checkoutBranch The branch that is currently checked out in wordpress-seo.
 *
 * @returns {string} The branch that we are going to checkout in the monorepo.
 */
function get_js_branch( checkoutBranch ) {
	return checkoutBranch === "trunk" ? "develop" : checkoutBranch;
}

/**
 * Try to checkout the given branch. If it fails, default to checking out develop.
 *
 * @param {string} javascriptBranch The branch that is going to be checked out on the JS monorepo.
 */
function checkout_branch_and_pull( javascriptBranch ) {
	try {
		// We have to do this in two execs because otherwise the try/catch does not work correct.
		execMonorepoNoOutput( `git checkout ${ javascriptBranch };` );
		execMonorepoNoOutput( `git pull;` );
		console.log( `Successfully checked out ${ javascriptBranch }.` );
	} catch ( e ) {
		execMonorepoNoOutput( `
			git checkout develop;
			git pull;	
		` );
		console.log( "Branch checkout failed. Defaulting to develop." );
	}
}

/**
 * Unlink all the yoast packages that are linked in the ~/.config/yarn/link directory.
 * Note: We cannot use "~" in the cwd field so we have to use a little workaround.
 */
function unlink_all_yoast_packages() {
	const homeDirectory = execSync( `echo $HOME` ).toString().split( "\n" )[ 0 ];
	const yarnLinkDir = homeDirectory + "/.config/yarn/link";

	const toRemove = execSync( `ls`, { cwd: yarnLinkDir } ).toString().split( "\n" ).filter( value => value.includes( "yoast" ) );

	var x;
	for ( x in toRemove ) {
		execSync( `rm -rf ${ toRemove[ x ] }`, { cwd: yarnLinkDir } );
	}

	// Remove the symlinks from node_modules.
	execSync( `rm -rf *yoast*`, { cwd: "./node_modules/" } );

	console.log( "All previously linked yoast packages have been unlinked." );
}

console.log( `Your monorepo is located in "${ monorepoLocation }". ` );

console.log( "Fetching the latest branches in the monorepo." );
execMonorepoNoOutput( `git fetch` );

const checkoutBranch = get_checkout_branch();
console.log( "Currently checked out branch is: " + checkoutBranch + "." );

const javascriptBranch = get_js_branch( checkoutBranch );
console.log( "Trying to checkout the monorepo branch: " + javascriptBranch + "." );

checkout_branch_and_pull( javascriptBranch );

const packages = execMonorepo( `ls packages` ).toString().split( "\n" ).filter( value => value !== "" );
unlink_all_yoast_packages();

execMonorepoNoOutput( `yarn link-all` );
console.log( "Packages have been linked inside the monorepo." );

for ( let x in packages ) {
	try {
		execSync( `yarn link @yoast/${ packages[ x ] }`, NO_OUTPUT );
	} catch ( e ) {
	}
}
console.log( "Successfully linked all new packages. Linking old format packages now." );
execSync( `yarn link yoastseo; yarn link yoast-components;`, NO_OUTPUT );
console.log( "Successfully linked all packages. Done." );