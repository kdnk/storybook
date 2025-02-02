/* eslint-disable no-param-reassign */
import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';
import chalk from 'chalk';
import { sync as spawnSync } from 'cross-spawn';
import { gt, satisfies } from 'semver';
import stripJsonComments from 'strip-json-comments';

import { latestVersion } from './latest_version';
import { npmInit } from './npm_init';
import { StoryFormat } from './project_types';
import { PackageJson } from './PackageJson';
import { NpmOptions } from './NpmOptions';

// Cannot be `import` as it's not under TS root dir
const { version, devDependencies } = require('../package.json');

const logger = console;

export async function getVersion(npmOptions: NpmOptions, packageName: string, constraint?: any) {
  let current;
  if (packageName === '@storybook/cli') {
    current = version;
  } else if (/storybook/.test(packageName)) {
    current = devDependencies[packageName];
  }

  let latest;
  try {
    latest = await latestVersion(npmOptions, packageName, constraint);
  } catch (e) {
    if (current) {
      logger.warn(`\n     ${chalk.yellow(e.message)}`);
      return current;
    }

    logger.error(`\n     ${chalk.red(e.message)}`);
    process.exit(1);
  }

  const versionToUse =
    current && (!constraint || satisfies(current, constraint)) && gt(current, latest)
      ? current
      : latest;
  return `^${versionToUse}`;
}

export function getVersions(npmOptions: NpmOptions, ...packageNames: string[]) {
  return Promise.all(packageNames.map((packageName) => getVersion(npmOptions, packageName)));
}

export function getVersionedPackages(npmOptions: NpmOptions, ...packageNames: string[]) {
  return Promise.all(
    packageNames.map(
      async (packageName) => `${packageName}@${await getVersion(npmOptions, packageName)}`
    )
  );
}

export function getPackageJson() {
  const packageJsonPath = path.resolve('package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  const jsonContent = fs.readFileSync(packageJsonPath, 'utf8');
  return JSON.parse(jsonContent);
}

export async function retrievePackageJson() {
  const existing = getPackageJson();
  if (existing) {
    return existing;
  }

  // npmInit will create a new package.json file
  npmInit();

  // read the newly created package.json file
  return getPackageJson() || {};
}

export function getBowerJson() {
  const bowerJsonPath = path.resolve('bower.json');
  if (!fs.existsSync(bowerJsonPath)) {
    return false;
  }

  const jsonContent = fs.readFileSync(bowerJsonPath, 'utf8');
  return JSON.parse(jsonContent);
}

export function readFileAsJson(jsonPath: string, allowComments?: boolean) {
  const filePath = path.resolve(jsonPath);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const jsonContent = allowComments ? stripJsonComments(fileContent) : fileContent;
  return JSON.parse(jsonContent);
}

export const writeFileAsJson = (jsonPath: string, content: unknown) => {
  const filePath = path.resolve(jsonPath);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`);
  return true;
};

export function writePackageJson(packageJson: object) {
  const content = `${JSON.stringify(packageJson, null, 2)}\n`;
  const packageJsonPath = path.resolve('package.json');

  fs.writeFileSync(packageJsonPath, content, 'utf8');
}

export const commandLog = (message: string) => {
  process.stdout.write(chalk.cyan(' • ') + message);

  // Need `void` to be able to use this function in a then of a Promise<void>
  return (errorMessage?: string | void, errorInfo?: string) => {
    if (errorMessage) {
      process.stdout.write(`. ${chalk.red('✖')}\n`);
      logger.error(`\n     ${chalk.red(errorMessage)}`);

      if (!errorInfo) {
        return;
      }

      const newErrorInfo = errorInfo
        .split('\n')
        .map((line) => `     ${chalk.dim(line)}`)
        .join('\n');
      logger.error(`${newErrorInfo}\n`);
      return;
    }

    process.stdout.write(`. ${chalk.green('✓')}\n`);
  };
};

export function paddedLog(message: string) {
  const newMessage = message
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');

  logger.log(newMessage);
}

export function getChars(char: string, amount: number) {
  let line = '';
  for (let lc = 0; lc < amount; lc += 1) {
    line += char;
  }

  return line;
}

export function codeLog(codeLines: string[], leftPadAmount?: number) {
  let maxLength = 0;
  const newLines = codeLines.map((line) => {
    maxLength = line.length > maxLength ? line.length : maxLength;
    return line;
  });

  const finalResult = newLines
    .map((line) => {
      const rightPadAmount = maxLength - line.length;
      let newLine = line + getChars(' ', rightPadAmount);
      newLine = getChars(' ', leftPadAmount || 2) + chalk.inverse(` ${newLine} `);
      return newLine;
    })
    .join('\n');

  logger.log(finalResult);
}

export function installDepsFromPackageJson(options: NpmOptions) {
  let done = commandLog('Preparing to install dependencies');
  done();
  logger.log();

  let result;
  if (options.useYarn) {
    result = spawnSync('yarn', { stdio: 'inherit' });
  } else {
    result = spawnSync('npm', ['install'], { stdio: 'inherit' });
  }

  logger.log();
  done = commandLog('Installing dependencies');
  if (result.status !== 0) {
    done('An error occurred while installing dependencies.');
    process.exit(1);
  }
  done();
}

/**
 * Add dependencies to a project using `yarn add` or `npm install`.
 *
 * @param {Object} options contains `useYarn`, `runInstall` and `installAsDevDependencies` which we use to determine how we install packages.
 * @param {Array} dependencies contains a list of packages to add.
 * @example
 * installDependencies(options, [
 *   `@storybook/react@${storybookVersion}`,
 *   `@storybook/addon-actions@${actionsVersion}`,
 *   `@storybook/addon-links@${linksVersion}`,
 *   `@storybook/addons@${addonsVersion}`,
 * ]);
 */
export function installDependencies(
  options: NpmOptions & { packageJson: PackageJson },
  dependencies: string[]
) {
  const { skipInstall } = options;

  if (skipInstall) {
    const { packageJson } = options;

    const dependenciesMap = dependencies.reduce((acc, dep) => {
      const idx = dep.lastIndexOf('@');
      const packageName = dep.slice(0, idx);
      const packageVersion = dep.slice(idx + 1);

      return { ...acc, [packageName]: packageVersion };
    }, {});

    if (options.installAsDevDependencies) {
      packageJson.devDependencies = {
        ...packageJson.devDependencies,
        ...dependenciesMap,
      };
    } else {
      packageJson.dependencies = {
        ...packageJson.dependencies,
        ...dependenciesMap,
      };
    }

    writePackageJson(packageJson);
  } else {
    const spawnCommand = options.useYarn ? 'yarn' : 'npm';
    const installCommand = options.useYarn ? 'add' : 'install';

    const installArgs = [installCommand, ...dependencies];

    if (options.installAsDevDependencies) {
      installArgs.push('-D');
    }

    if (options.useYarn) {
      installArgs.push('--ignore-workspace-root-check');
    }

    const dependencyResult = spawnSync(spawnCommand, installArgs, {
      stdio: 'inherit',
    });

    if (dependencyResult.status !== 0) {
      logger.error('An error occurred while installing dependencies.');
      logger.log(dependencyResult);
      process.exit(1);
    }
  }
}

/**
 * Detect if any babel dependencies need to be added to the project
 * @param {Object} npmOptions Passed along to `latestVersion` and `getVersion`
 * @param {Object} packageJson The current package.json so we can inspect its contents
 * @returns {Array} Contains the packages and versions that need to be installed
 * @example
 * const babelDependencies = await getBabelDependencies(npmOptions, packageJson);
 * // you can then spread the result when using installDependencies
 * installDependencies(npmOptions, [
 *   `@storybook/react@${storybookVersion}`,
 *   ...babelDependencies,
 * ]);
 */
export async function getBabelDependencies(npmOptions: NpmOptions, packageJson: PackageJson) {
  const dependenciesToAdd = [];
  let babelLoaderVersion = '^8.0.0-0';

  const babelCoreVersion =
    packageJson.dependencies['babel-core'] || packageJson.devDependencies['babel-core'];

  if (!babelCoreVersion) {
    if (!packageJson.dependencies['@babel/core'] && !packageJson.devDependencies['@babel/core']) {
      const babelCoreInstallVersion = await getVersion(npmOptions, '@babel/core');
      dependenciesToAdd.push(`@babel/core@${babelCoreInstallVersion}`);
    }
  } else {
    const latestCompatibleBabelVersion = await latestVersion(
      npmOptions,
      'babel-core',
      babelCoreVersion
    );
    // Babel 6
    if (satisfies(latestCompatibleBabelVersion, '^6.0.0')) {
      babelLoaderVersion = '^7.0.0';
    }
  }

  if (!packageJson.dependencies['babel-loader'] && !packageJson.devDependencies['babel-loader']) {
    const babelLoaderInstallVersion = await getVersion(
      npmOptions,
      'babel-loader',
      babelLoaderVersion
    );
    dependenciesToAdd.push(`babel-loader@${babelLoaderInstallVersion}`);
  }

  return dependenciesToAdd;
}

export function addToDevDependenciesIfNotPresent(
  packageJson: PackageJson,
  name: string,
  packageVersion: string
) {
  if (!packageJson.dependencies[name] && !packageJson.devDependencies[name]) {
    packageJson.devDependencies[name] = packageVersion;
  }
}

export function copyTemplate(templateRoot: string, storyFormat: StoryFormat) {
  const templateDir = path.resolve(templateRoot, `template-${storyFormat}/`);
  if (!fs.existsSync(templateDir)) {
    // Fallback to CSF plain first, in case format is typescript but template is not available.
    if (storyFormat === StoryFormat.CSF_TYPESCRIPT) {
      copyTemplate(templateRoot, StoryFormat.CSF);
      return;
    }

    throw new Error(`Unsupported story format: ${storyFormat}`);
  }
  fse.copySync(templateDir, '.', { overwrite: true });
}
