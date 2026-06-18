const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const cheqPkgRoot = path.resolve(workspaceRoot, 'source/cheq-enforce-react');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot, cheqPkgRoot];

config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];

// Force the package name → real source path (avoids symlink issues in workspaces)
config.resolver.extraNodeModules = {
    '@cheq.ai/cheq-enforce-react': cheqPkgRoot,
};

config.resolver.unstable_enableSymlinks = true;

module.exports = config;
