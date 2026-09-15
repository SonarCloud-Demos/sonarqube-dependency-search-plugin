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
package org.sonar.plugin.dependency.search;

import java.util.Optional;
import org.junit.Test;
import org.sonar.api.config.Configuration;
import org.sonar.api.web.page.Page;
import org.sonar.api.web.page.Page.Qualifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class DependencySearchPluginTest {

  private static Configuration configWithEnabled(boolean enabled) {
    Configuration configuration = mock(Configuration.class);
    when(configuration.getBoolean(DependencySearchPlugin.ENABLED_KEY)).thenReturn(Optional.of(enabled));
    return configuration;
  }

  @Test
  public void component_page_definition_registers_project_app_portfolio_tab_when_enabled() {
    org.sonar.api.web.page.Context ctx = new org.sonar.api.web.page.Context();
    new DependencySearchPageDefinition(configWithEnabled(true)).define(ctx);

    assertThat(ctx.getPages()).hasSize(1);
    Page page = ctx.getPages().iterator().next();
    assertThat(page.getKey()).isEqualTo("dependencysearch/search");
    assertThat(page.getName()).isEqualTo("Dependency Search");
    assertThat(page.getComponentQualifiers())
      .contains(Qualifier.PROJECT, Qualifier.APP, Qualifier.VIEW, Qualifier.SUB_VIEW);
    assertThat(page.isAdmin()).isFalse();
  }

  @Test
  public void component_page_definition_registers_nothing_when_disabled() {
    org.sonar.api.web.page.Context ctx = new org.sonar.api.web.page.Context();
    new DependencySearchPageDefinition(configWithEnabled(false)).define(ctx);

    assertThat(ctx.getPages()).isEmpty();
  }

  @Test
  public void global_page_definition_registers_non_admin_global_page_when_enabled() {
    org.sonar.api.web.page.Context ctx = new org.sonar.api.web.page.Context();
    new DependencySearchGlobalPageDefinition(configWithEnabled(true)).define(ctx);

    assertThat(ctx.getPages()).hasSize(1);
    Page page = ctx.getPages().iterator().next();
    assertThat(page.getKey()).isEqualTo("dependencysearch/global");
    assertThat(page.isAdmin()).isFalse();
  }

  @Test
  public void global_page_definition_registers_nothing_when_disabled() {
    org.sonar.api.web.page.Context ctx = new org.sonar.api.web.page.Context();
    new DependencySearchGlobalPageDefinition(configWithEnabled(false)).define(ctx);

    assertThat(ctx.getPages()).isEmpty();
  }

  @Test
  public void admin_page_definition_registers_admin_global_page_regardless_of_enabled_setting() {
    org.sonar.api.web.page.Context ctx = new org.sonar.api.web.page.Context();
    new DependencySearchAdminPageDefinition().define(ctx);

    assertThat(ctx.getPages()).hasSize(1);
    Page page = ctx.getPages().iterator().next();
    assertThat(page.getKey()).isEqualTo("dependencysearch/admin");
    assertThat(page.isAdmin()).isTrue();
  }
}
