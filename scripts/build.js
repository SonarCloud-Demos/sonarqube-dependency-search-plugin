/*
 * SonarQube Dependency Search Plugin
 * Copyright (C) 2026 SonarSource Sàrl
 * mailto:info AT sonarsource DOT com
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 */
const path = require('path');
const fs = require('fs-extra');
const esbuild = require('esbuild');
const getConfig = require('../conf/esbuild-config');

const release = process.argv.includes('release');
const outdir = path.join(__dirname, '../target/classes/static');

fs.emptyDirSync(outdir);

esbuild
  .build(getConfig(release))
  .then(() => console.log('Build complete.'))
  .catch(() => process.exit(1));
