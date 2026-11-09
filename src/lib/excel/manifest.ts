/**
 * The Office add-in manifest for Uprali in Excel (the XML "add-in only" format, which Excel on
 * the web, Windows and Mac can all sideload). Every URL points at the site that serves it, so
 * the same code works on production and on a preview deployment.
 */

/** Fixed forever: Excel uses it to know this is the same add-in after an update. */
export const ADDIN_ID = "b7d27322-edff-4056-8d30-7aa4eeb255dc";
export const ADDIN_VERSION = "1.0.0.0";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function manifestXml(baseUrl: string): string {
  const base = esc(baseUrl.replace(/\/+$/, ""));
  const u = (p: string) => `${base}${p}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>${ADDIN_ID}</Id>
  <Version>${ADDIN_VERSION}</Version>
  <ProviderName>Uprali</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Uprali"/>
  <Description DefaultValue="Uprali, the AI financial analyst: build a live build vs buy model in your workbook, with real formulas you can change."/>
  <IconUrl DefaultValue="${u("/excel/assets/icon-32.png")}"/>
  <HighResolutionIconUrl DefaultValue="${u("/excel/assets/icon-64.png")}"/>
  <SupportUrl DefaultValue="${u("/excel/help.html")}"/>
  <AppDomains>
    <AppDomain>${base}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Workbook"/>
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.1">
      <Set Name="ExcelApi" MinVersion="1.4"/>
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${u("/excel/taskpane.html")}"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Workbook">
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMoreUrl"/>
          </GetStarted>
          <FunctionFile resid="Commands.Url"/>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="Uprali.Group">
                <Label resid="Group.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16"/>
                  <bt:Image size="32" resid="Icon.32"/>
                  <bt:Image size="80" resid="Icon.80"/>
                </Icon>
                <Control xsi:type="Button" id="Uprali.OpenPane">
                  <Label resid="Button.Label"/>
                  <Supertip>
                    <Title resid="Button.Label"/>
                    <Description resid="Button.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16"/>
                    <bt:Image size="32" resid="Icon.32"/>
                    <bt:Image size="80" resid="Icon.80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>Uprali.Pane</TaskpaneId>
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16" DefaultValue="${u("/excel/assets/icon-16.png")}"/>
        <bt:Image id="Icon.32" DefaultValue="${u("/excel/assets/icon-32.png")}"/>
        <bt:Image id="Icon.80" DefaultValue="${u("/excel/assets/icon-80.png")}"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="Commands.Url" DefaultValue="${u("/excel/commands.html")}"/>
        <bt:Url id="Taskpane.Url" DefaultValue="${u("/excel/taskpane.html")}"/>
        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="${u("/excel/help.html")}"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GetStarted.Title" DefaultValue="Uprali is ready"/>
        <bt:String id="Group.Label" DefaultValue="Uprali"/>
        <bt:String id="Button.Label" DefaultValue="Uprali models"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Open Uprali from the Home tab to build a live build vs buy model in a new sheet."/>
        <bt:String id="Button.Tooltip" DefaultValue="Open the Uprali panel to build a live build vs buy model with real formulas."/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`;
}
