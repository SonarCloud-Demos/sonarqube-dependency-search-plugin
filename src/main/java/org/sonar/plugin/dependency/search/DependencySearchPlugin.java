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

import org.sonar.api.Plugin;
import org.sonar.api.PropertyType;
import org.sonar.api.config.PropertyDefinition;

public class DependencySearchPlugin implements Plugin {

  public static final String ENABLED_KEY = "dependencysearch.enabled";
  public static final String THROTTLE_RPS_KEY = "dependencysearch.throttle.rps";
  /** Rows the results table pages through at once — a UX/display setting only.
   * Unrelated to the network fetch page size, which is a fixed constant (the
   * server's hard cap of 500) and not configurable. */
  public static final String RESULTS_PAGE_SIZE_KEY = "dependencysearch.pageSize";
  /** Below this many distinct values, a column's filter renders as a checkbox
   * picker instead of free text — cheap enough to compute client-side that it
   * doesn't need its own throttle, just a sane default. */
  public static final String FILTER_DROPDOWN_THRESHOLD_KEY = "dependencysearch.filterDropdownThreshold";
  private static final String CATEGORY = "Dependency Search";

  @Override
  public void define(Context context) {
    context.addExtension(DependencySearchPageDefinition.class);
    context.addExtension(DependencySearchGlobalPageDefinition.class);
    context.addExtension(DependencySearchAdminPageDefinition.class);
    context.addExtension(
      PropertyDefinition.builder(ENABLED_KEY)
        .name("Enable Dependency Search")
        .description("When disabled, the Dependency Search tabs and global page are not registered at all — no menu entries in projects, applications, portfolios, or the global \"More\" menu, and no API calls. This admin page itself always stays reachable, so the feature can be re-enabled. The page registry is built once, so toggling this requires a SonarQube restart before the menus appear or disappear.")
        .defaultValue("true")
        .type(PropertyType.BOOLEAN)
        .category(CATEGORY)
        .build()
    );
    context.addExtension(
      PropertyDefinition.builder(THROTTLE_RPS_KEY)
        .name("Request throttle (requests/sec)")
        .description("Maximum requests/second to api/v2/sca/releases, shared across every branch/PR/project a search fans out to. Raise on large instances if searches feel too slow; lower it if it's straining the server. Editable from Administration → Dependency Search.")
        .defaultValue("10")
        .type(PropertyType.INTEGER)
        .category(CATEGORY)
        .build()
    );
    context.addExtension(
      PropertyDefinition.builder(RESULTS_PAGE_SIZE_KEY)
        .name("Results page size")
        .description("Rows the results table pages through at once — a display setting only, unrelated to how many dependencies are fetched per network request (that's a fixed constant at the server's hard cap). Editable from Administration → Dependency Search.")
        .defaultValue("1000")
        .type(PropertyType.INTEGER)
        .category(CATEGORY)
        .build()
    );
    context.addExtension(
      PropertyDefinition.builder(FILTER_DROPDOWN_THRESHOLD_KEY)
        .name("Filter dropdown threshold")
        .description("Below this many distinct values, a column's filter shows a checkbox picker of the actual values instead of free text; at or above it, free text with autocomplete suggestions. Editable from Administration → Dependency Search.")
        .defaultValue("12")
        .type(PropertyType.INTEGER)
        .category(CATEGORY)
        .build()
    );
  }
}
