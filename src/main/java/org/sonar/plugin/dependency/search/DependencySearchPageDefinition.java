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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */
package org.sonar.plugin.dependency.search;

import org.sonar.api.config.Configuration;
import org.sonar.api.web.page.Context;
import org.sonar.api.web.page.Page;
import org.sonar.api.web.page.Page.Qualifier;
import org.sonar.api.web.page.Page.Scope;
import org.sonar.api.web.page.PageDefinition;

/** Project / application / portfolio tab. Not registered at all when the plugin is
 * disabled (dependencysearch.enabled) — the page registry is built once, so toggling
 * the setting requires a SonarQube restart before the tab appears/disappears. */
public class DependencySearchPageDefinition implements PageDefinition {

  private final Configuration configuration;

  public DependencySearchPageDefinition(Configuration configuration) {
    this.configuration = configuration;
  }

  @Override
  public void define(Context context) {
    if (!configuration.getBoolean(DependencySearchPlugin.ENABLED_KEY).orElse(true)) {
      return;
    }
    context.addPage(Page.builder("dependencysearch/search")
      .setName("Dependency Search")
      .setScope(Scope.COMPONENT)
      .setComponentQualifiers(Qualifier.PROJECT, Qualifier.APP, Qualifier.VIEW, Qualifier.SUB_VIEW)
      .build());
  }
}
