#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import OpenAI from 'openai';
import semver from 'semver';

const VERSION = '1.0.0';

program
  .name('ai-pkg-health')
  .description('Analyze package.json health - find issues, suggest fixes')
  .version(VERSION)
  .option('-d, --dir <path>', 'Directory with package.json', '.')
  .option('--no-ai', 'Skip AI analysis')
  .option('--fix', 'Auto-fix common issues')
  .option('--json', 'Output as JSON')
  .parse();

const opts = program.opts();

const REQUIRED_FIELDS = ['name', 'version', 'description', 'main', 'license'];
const RECOMMENDED_FIELDS = ['author', 'repository', 'keywords', 'engines', 'homepage'];

// Known problematic or deprecated packages
const PROBLEMATIC_PACKAGES = {
  'request': 'Use axios, got, or native fetch instead',
  'moment': 'Use date-fns or dayjs instead (smaller)',
  'lodash': 'Consider lodash-es or individual imports',
  'underscore': 'Use lodash or native JS methods',
  'left-pad': 'Use String.prototype.padStart()',
  'is-odd': 'Use n % 2 !== 0',
  'is-even': 'Use n % 2 === 0',
  'is-positive': 'Use n > 0',
  'is-negative': 'Use n < 0',
  'uuid': 'Use crypto.randomUUID() in Node 19+',
  'node-fetch': 'Use native fetch in Node 18+',
  'cross-fetch': 'Use native fetch in Node 18+',
  'querystring': 'Use URLSearchParams',
  'colors': 'Use chalk or picocolors (security)',
  'faker': 'Use @faker-js/faker (maintained fork)'
};

// Overlapping packages
const OVERLAPPING = [
  ['axios', 'got', 'node-fetch', 'request', 'superagent'],
  ['lodash', 'underscore', 'ramda'],
  ['moment', 'dayjs', 'date-fns', 'luxon'],
  ['chalk', 'colors', 'picocolors', 'kleur'],
  ['commander', 'yargs', 'meow', 'minimist'],
  ['express', 'koa', 'fastify', 'hapi'],
  ['jest', 'mocha', 'vitest', 'ava'],
  ['winston', 'pino', 'bunyan', 'log4js']
];

async function loadPackageJson(dir) {
  const pkgPath = path.join(dir, 'package.json');
  try {
    const content = await fs.readFile(pkgPath, 'utf-8');
    return { pkg: JSON.parse(content), path: pkgPath };
  } catch (err) {
    return null;
  }
}

function checkRequiredFields(pkg) {
  const issues = [];
  for (const field of REQUIRED_FIELDS) {
    if (!pkg[field]) {
      issues.push({ type: 'error', field, message: `Missing required field: ${field}` });
    }
  }
  return issues;
}

function checkRecommendedFields(pkg) {
  const issues = [];
  for (const field of RECOMMENDED_FIELDS) {
    if (!pkg[field]) {
      issues.push({ type: 'warning', field, message: `Missing recommended field: ${field}` });
    }
  }
  return issues;
}

function checkVersions(pkg) {
  const issues = [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  
  for (const [name, version] of Object.entries(deps)) {
    // Check for wildcards
    if (version === '*' || version === 'latest') {
      issues.push({ 
        type: 'error', 
        field: name, 
        message: `Unsafe version: ${name}@${version} - pin to specific version` 
      });
    }
    
    // Check for git URLs
    if (version.includes('git') || version.includes('github')) {
      issues.push({ 
        type: 'warning', 
        field: name, 
        message: `Git dependency: ${name} - consider using npm version` 
      });
    }
    
    // Check for file: references
    if (version.startsWith('file:')) {
      issues.push({ 
        type: 'warning', 
        field: name, 
        message: `Local file dependency: ${name} - won't work when published` 
      });
    }
  }
  
  return issues;
}

function checkProblematicPackages(pkg) {
  const issues = [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  
  for (const [name] of Object.entries(deps)) {
    if (PROBLEMATIC_PACKAGES[name]) {
      issues.push({
        type: 'warning',
        field: name,
        message: `${name}: ${PROBLEMATIC_PACKAGES[name]}`
      });
    }
  }
  
  return issues;
}

function checkOverlappingPackages(pkg) {
  const issues = [];
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  
  for (const group of OVERLAPPING) {
    const found = group.filter(p => deps.includes(p));
    if (found.length > 1) {
      issues.push({
        type: 'warning',
        field: 'dependencies',
        message: `Overlapping packages: ${found.join(', ')} - consider using just one`
      });
    }
  }
  
  return issues;
}

function checkScripts(pkg) {
  const issues = [];
  
  if (!pkg.scripts) {
    issues.push({ type: 'warning', field: 'scripts', message: 'No scripts defined' });
    return issues;
  }
  
  const recommended = ['test', 'build', 'start', 'lint'];
  for (const script of recommended) {
    if (!pkg.scripts[script]) {
      issues.push({ 
        type: 'info', 
        field: `scripts.${script}`, 
        message: `Consider adding a "${script}" script` 
      });
    }
  }
  
  return issues;
}

function checkDuplicates(pkg) {
  const issues = [];
  const deps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  
  const duplicates = deps.filter(d => devDeps.includes(d));
  for (const dup of duplicates) {
    issues.push({
      type: 'error',
      field: dup,
      message: `${dup} is in both dependencies and devDependencies`
    });
  }
  
  return issues;
}

function checkSize(pkg) {
  const issues = [];
  const depCount = Object.keys(pkg.dependencies || {}).length;
  const devDepCount = Object.keys(pkg.devDependencies || {}).length;
  
  if (depCount > 50) {
    issues.push({
      type: 'warning',
      field: 'dependencies',
      message: `${depCount} dependencies is quite large - consider auditing`
    });
  }
  
  if (devDepCount > 100) {
    issues.push({
      type: 'info',
      field: 'devDependencies',
      message: `${devDepCount} dev dependencies - typical for large projects`
    });
  }
  
  return issues;
}

async function getOutdatedPackages() {
  try {
    const output = execSync('npm outdated --json 2>/dev/null', { encoding: 'utf-8' });
    return JSON.parse(output || '{}');
  } catch {
    return {};
  }
}

async function analyzeWithAI(pkg, issues) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  
  const openai = new OpenAI();
  
  const issuesSummary = issues.slice(0, 20).map(i => `- [${i.type}] ${i.message}`).join('\n');
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a Node.js package expert. Analyze package.json and provide actionable recommendations. Be concise.'
      },
      {
        role: 'user',
        content: `Analyze this package.json and issues found:

Package: ${pkg.name}@${pkg.version}
Description: ${pkg.description || 'None'}
Dependencies: ${Object.keys(pkg.dependencies || {}).length}
DevDependencies: ${Object.keys(pkg.devDependencies || {}).length}

Issues found:
${issuesSummary}

Provide:
1. Top 3 priority fixes
2. Security concerns (if any)
3. Quick wins for improvement`
      }
    ],
    max_tokens: 800
  });
  
  return response.choices[0].message.content;
}

async function main() {
  console.log(chalk.bold.cyan('\n📦 Package Health Check\n'));
  
  const spinner = ora('Loading package.json...').start();
  
  // Load package.json
  const result = await loadPackageJson(opts.dir);
  if (!result) {
    spinner.fail('No package.json found');
    console.log(chalk.gray(`\nSearched in: ${path.resolve(opts.dir)}`));
    process.exit(1);
  }
  
  const { pkg, path: pkgPath } = result;
  spinner.succeed(`Loaded: ${pkg.name}@${pkg.version}`);
  
  // Run all checks
  const allIssues = [
    ...checkRequiredFields(pkg),
    ...checkRecommendedFields(pkg),
    ...checkVersions(pkg),
    ...checkProblematicPackages(pkg),
    ...checkOverlappingPackages(pkg),
    ...checkScripts(pkg),
    ...checkDuplicates(pkg),
    ...checkSize(pkg)
  ];
  
  // Check for outdated packages
  spinner.text = 'Checking for outdated packages...';
  spinner.start();
  const outdated = await getOutdatedPackages();
  const outdatedCount = Object.keys(outdated).length;
  if (outdatedCount > 0) {
    allIssues.push({
      type: 'info',
      field: 'dependencies',
      message: `${outdatedCount} packages have updates available`
    });
  }
  spinner.stop();
  
  // Categorize issues
  const errors = allIssues.filter(i => i.type === 'error');
  const warnings = allIssues.filter(i => i.type === 'warning');
  const infos = allIssues.filter(i => i.type === 'info');
  
  // Calculate score
  const maxScore = 100;
  const score = Math.max(0, maxScore - (errors.length * 15) - (warnings.length * 5) - (infos.length * 1));
  
  // Display results
  const scoreColor = score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red';
  console.log(chalk[scoreColor](`\n🏥 Health Score: ${score}/100\n`));
  
  if (errors.length > 0) {
    console.log(chalk.red(`❌ Errors (${errors.length}):`));
    errors.forEach(e => console.log(chalk.red(`   • ${e.message}`)));
    console.log();
  }
  
  if (warnings.length > 0) {
    console.log(chalk.yellow(`⚠️  Warnings (${warnings.length}):`));
    warnings.forEach(w => console.log(chalk.yellow(`   • ${w.message}`)));
    console.log();
  }
  
  if (infos.length > 0) {
    console.log(chalk.blue(`ℹ️  Info (${infos.length}):`));
    infos.forEach(i => console.log(chalk.gray(`   • ${i.message}`)));
    console.log();
  }
  
  if (allIssues.length === 0) {
    console.log(chalk.green('✅ Your package.json looks healthy!\n'));
    return;
  }
  
  // AI Analysis
  if (opts.ai !== false && process.env.OPENAI_API_KEY) {
    const aiSpinner = ora('Getting AI recommendations...').start();
    try {
      const aiAnalysis = await analyzeWithAI(pkg, allIssues);
      aiSpinner.succeed('AI analysis complete');
      
      if (aiAnalysis) {
        console.log(chalk.cyan('\n🤖 AI Recommendations:\n'));
        console.log(aiAnalysis);
        console.log();
      }
    } catch (err) {
      aiSpinner.fail('AI analysis failed');
    }
  } else if (opts.ai !== false) {
    console.log(chalk.gray('💡 Set OPENAI_API_KEY for AI-powered recommendations\n'));
  }
  
  // Summary
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.white(`Dependencies: ${Object.keys(pkg.dependencies || {}).length}`));
  console.log(chalk.white(`DevDependencies: ${Object.keys(pkg.devDependencies || {}).length}`));
  if (outdatedCount > 0) {
    console.log(chalk.white(`Outdated: ${outdatedCount} (run npm outdated for details)`));
  }
  console.log();
}

main();
