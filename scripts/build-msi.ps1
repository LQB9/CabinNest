param([string]$Payload,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $Payload){$Payload=Join-Path $taskRoot 'release\CabinNest-win32-x64'}
if(-not $OutputDirectory){$OutputDirectory=Join-Path $taskRoot 'dist'}
$taskPayload=(Resolve-Path -LiteralPath $Payload).ProviderPath
$taskOutput=[IO.Path]::GetFullPath($OutputDirectory)
$taskVersion=(Get-Content -LiteralPath (Join-Path $taskPayload 'resources\app\package.json') -Raw | ConvertFrom-Json).version
if($taskVersion -notmatch '^\d+\.\d+\.\d+$'){throw 'MSI 版本无效'}
if(Test-Path -LiteralPath (Join-Path $taskPayload 'data')){throw '安装包不得包含用户资料'}
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskStage=Join-Path $taskOutput ('msi-build-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskStage | Out-Null
$taskMsi=Join-Path $taskOutput "CabinNest-$taskVersion-x64.msi"
if(Test-Path -LiteralPath $taskMsi){throw '安装包已存在，请使用新的输出目录'}
$taskInstaller=New-Object -ComObject WindowsInstaller.Installer
function Call-Com($Object,[string]$Name,[object[]]$Arguments){
 switch($Name){
  'OpenDatabase' {$Object.OpenDatabase([string]$Arguments[0],[int]$Arguments[1])}
  'OpenView' {$Object.OpenView([string]$Arguments[0])}
  'CreateRecord' {$Object.CreateRecord([int]$Arguments[0])}
  'Execute' {if($Arguments.Count){$Object.Execute($Arguments[0])}else{$Object.Execute()}}
  'Close' {$Object.Close()}
  'Import' {$Object.Import([string]$Arguments[0],[string]$Arguments[1])}
  'SetStream' {$Object.SetStream([int]$Arguments[0],[string]$Arguments[1])}
  'SummaryInformation' {$Object.SummaryInformation([int]$Arguments[0])}
  'Persist' {$Object.Persist()}
  'Commit' {$Object.Commit()}
  default {throw "Unknown MSI method: $Name"}
 }
}
function Set-Com($Object,[string]$Name,[object[]]$Arguments){
 switch($Name){
  'StringData' {$Object.StringData([int]$Arguments[0])=[string]$Arguments[1]}
  'IntegerData' {$Object.IntegerData([int]$Arguments[0])=[int]$Arguments[1]}
  'Property' {$Object.Property([int]$Arguments[0])=$Arguments[1]}
  default {throw "Unknown MSI property: $Name"}
 }
}
function Stable-Guid([string]$Value){$taskBytes=[Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes('CabinNest MSI '+$Value));return '{'+([guid]::new([byte[]]$taskBytes[0..15])).ToString().ToUpperInvariant()+'}'}
$taskProductCode=Stable-Guid ('product '+$taskVersion)
$taskUpgradeCode='{CD88FDDD-5CA2-4B3F-9FB7-755FB17269F7}'
$taskDb=Call-Com $taskInstaller 'OpenDatabase' @($taskMsi,3)
function Sql([string]$Query){$taskView=Call-Com $taskDb 'OpenView' @($Query);try{Call-Com $taskView 'Execute' @() | Out-Null}finally{Call-Com $taskView 'Close' @() | Out-Null;[void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskView)}}
function Row([string]$Table,[string[]]$Columns,[object[]]$Values){
 $taskQuery='INSERT INTO `'+$Table+'` (`'+($Columns -join '`,`')+'`) VALUES ('+((@('?')*$Values.Count)-join ',')+')'
 $taskView=Call-Com $taskDb 'OpenView' @($taskQuery);$taskRecord=Call-Com $taskInstaller 'CreateRecord' @($Values.Count)
 try{for($taskIndex=0;$taskIndex -lt $Values.Count;$taskIndex++){if($null -ne $Values[$taskIndex]){if($Values[$taskIndex] -is [int]){Set-Com $taskRecord 'IntegerData' @(($taskIndex+1),$Values[$taskIndex])}else{Set-Com $taskRecord 'StringData' @(($taskIndex+1),[string]$Values[$taskIndex])}}};Call-Com $taskView 'Execute' @($taskRecord)|Out-Null}finally{Call-Com $taskView 'Close' @()|Out-Null;[void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskRecord);[void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskView)}
}
[IO.File]::WriteAllText((Join-Path $taskStage 'codepage.idt'),"`r`n`r`n936`t_ForceCodepage`r`n",[Text.Encoding]::ASCII)
Call-Com $taskDb 'Import' @($taskStage,'codepage.idt') | Out-Null
Sql 'CREATE TABLE `Property` (`Property` CHAR(72) NOT NULL, `Value` CHAR(0) LOCALIZABLE PRIMARY KEY `Property`)'
Sql 'CREATE TABLE `Directory` (`Directory` CHAR(72) NOT NULL, `Directory_Parent` CHAR(72), `DefaultDir` CHAR(255) NOT NULL LOCALIZABLE PRIMARY KEY `Directory`)'
Sql 'CREATE TABLE `Component` (`Component` CHAR(72) NOT NULL, `ComponentId` CHAR(38), `Directory_` CHAR(72) NOT NULL, `Attributes` SHORT NOT NULL, `Condition` CHAR(255), `KeyPath` CHAR(72) PRIMARY KEY `Component`)'
Sql 'CREATE TABLE `Feature` (`Feature` CHAR(38) NOT NULL, `Feature_Parent` CHAR(38), `Title` CHAR(64) LOCALIZABLE, `Description` CHAR(255) LOCALIZABLE, `Display` SHORT, `Level` SHORT NOT NULL, `Directory_` CHAR(72), `Attributes` SHORT NOT NULL PRIMARY KEY `Feature`)'
Sql 'CREATE TABLE `FeatureComponents` (`Feature_` CHAR(38) NOT NULL, `Component_` CHAR(72) NOT NULL PRIMARY KEY `Feature_`, `Component_`)'
Sql 'CREATE TABLE `File` (`File` CHAR(72) NOT NULL, `Component_` CHAR(72) NOT NULL, `FileName` CHAR(255) NOT NULL LOCALIZABLE, `FileSize` LONG NOT NULL, `Version` CHAR(72), `Language` CHAR(20), `Attributes` SHORT, `Sequence` LONG NOT NULL PRIMARY KEY `File`)'
Sql 'CREATE TABLE `MsiFileHash` (`File_` CHAR(72) NOT NULL, `Options` SHORT NOT NULL, `HashPart1` LONG NOT NULL, `HashPart2` LONG NOT NULL, `HashPart3` LONG NOT NULL, `HashPart4` LONG NOT NULL PRIMARY KEY `File_`)'
Sql 'CREATE TABLE `Media` (`DiskId` SHORT NOT NULL, `LastSequence` LONG NOT NULL, `DiskPrompt` CHAR(64) LOCALIZABLE, `Cabinet` CHAR(255), `VolumeLabel` CHAR(32), `Source` CHAR(72) PRIMARY KEY `DiskId`)'
Sql 'CREATE TABLE `Shortcut` (`Shortcut` CHAR(72) NOT NULL, `Directory_` CHAR(72) NOT NULL, `Name` CHAR(128) NOT NULL LOCALIZABLE, `Component_` CHAR(72) NOT NULL, `Target` CHAR(255) NOT NULL, `Arguments` CHAR(255), `Description` CHAR(255) LOCALIZABLE, `Hotkey` SHORT, `Icon_` CHAR(72), `IconIndex` SHORT, `ShowCmd` SHORT, `WkDir` CHAR(72) PRIMARY KEY `Shortcut`)'
Sql 'CREATE TABLE `CreateFolder` (`Directory_` CHAR(72) NOT NULL, `Component_` CHAR(72) NOT NULL PRIMARY KEY `Directory_`, `Component_`)'
Sql 'CREATE TABLE `Upgrade` (`UpgradeCode` CHAR(38) NOT NULL, `VersionMin` CHAR(20), `VersionMax` CHAR(20), `Language` CHAR(255), `Attributes` LONG NOT NULL, `Remove` CHAR(255), `ActionProperty` CHAR(72) NOT NULL PRIMARY KEY `UpgradeCode`, `VersionMin`, `VersionMax`, `Language`, `Attributes`)'
Sql 'CREATE TABLE `LaunchCondition` (`Condition` CHAR(255) NOT NULL, `Description` CHAR(255) NOT NULL LOCALIZABLE PRIMARY KEY `Condition`)'
Sql 'CREATE TABLE `CustomAction` (`Action` CHAR(72) NOT NULL, `Type` SHORT NOT NULL, `Source` CHAR(72), `Target` CHAR(255) PRIMARY KEY `Action`)'
foreach($taskTable in @('InstallExecuteSequence','InstallUISequence')){Sql ('CREATE TABLE `'+$taskTable+'` (`Action` CHAR(72) NOT NULL, `Condition` CHAR(255), `Sequence` SHORT PRIMARY KEY `Action`)')}
Sql 'CREATE TABLE `Dialog` (`Dialog` CHAR(72) NOT NULL, `HCentering` SHORT NOT NULL, `VCentering` SHORT NOT NULL, `Width` SHORT NOT NULL, `Height` SHORT NOT NULL, `Attributes` LONG, `Title` CHAR(128) LOCALIZABLE, `Control_First` CHAR(50), `Control_Default` CHAR(50), `Control_Cancel` CHAR(50) PRIMARY KEY `Dialog`)'
Sql 'CREATE TABLE `Control` (`Dialog_` CHAR(72) NOT NULL, `Control` CHAR(50) NOT NULL, `Type` CHAR(20) NOT NULL, `X` SHORT NOT NULL, `Y` SHORT NOT NULL, `Width` SHORT NOT NULL, `Height` SHORT NOT NULL, `Attributes` LONG, `Property` CHAR(72), `Text` CHAR(0) LOCALIZABLE, `Control_Next` CHAR(50), `Help` CHAR(50) LOCALIZABLE PRIMARY KEY `Dialog_`, `Control`)'
Sql 'CREATE TABLE `ControlEvent` (`Dialog_` CHAR(72) NOT NULL, `Control_` CHAR(50) NOT NULL, `Event` CHAR(50) NOT NULL, `Argument` CHAR(255) NOT NULL, `Condition` CHAR(255), `Ordering` SHORT PRIMARY KEY `Dialog_`, `Control_`, `Event`, `Argument`, `Condition`)'
Sql 'CREATE TABLE `EventMapping` (`Dialog_` CHAR(72) NOT NULL, `Control_` CHAR(50) NOT NULL, `Event` CHAR(50) NOT NULL, `Attribute` CHAR(50) NOT NULL PRIMARY KEY `Dialog_`, `Control_`, `Event`)'
Sql 'CREATE TABLE `TextStyle` (`TextStyle` CHAR(72) NOT NULL, `FaceName` CHAR(32) NOT NULL LOCALIZABLE, `Size` SHORT NOT NULL, `Color` LONG, `StyleBits` SHORT PRIMARY KEY `TextStyle`)'
$taskProperties=@{ProductCode=$taskProductCode;UpgradeCode=$taskUpgradeCode;ProductName='CabinNest';ProductVersion=$taskVersion;Manufacturer='CabinNest';ProductLanguage='2052';INSTALLLEVEL='1';MSIINSTALLPERUSER='1';ARPNOMODIFY='1';ARPNOREPAIR='1';ARPURLINFOABOUT='https://github.com/LQB9/CabinNest';SecureCustomProperties='OLDPRODUCTS;NEWERPRODUCTS';DefaultUIFont='UiFont'}
foreach($taskKey in $taskProperties.Keys){Row 'Property' @('Property','Value') @($taskKey,$taskProperties[$taskKey])}
Row 'Directory' @('Directory','Directory_Parent','DefaultDir') @('TARGETDIR',$null,'SourceDir')
foreach($taskRow in @(@('LocalAppDataFolder','TARGETDIR','.'),@('ProgramsFolder','LocalAppDataFolder','Programs'),@('INSTALLFOLDER','ProgramsFolder','CabinNest'),@('DesktopFolder','TARGETDIR','.'),@('ProgramMenuFolder','TARGETDIR','.'),@('CabinNestMenuFolder','ProgramMenuFolder','CabinNest'))){Row 'Directory' @('Directory','Directory_Parent','DefaultDir') $taskRow}
Row 'Feature' @('Feature','Title','Display','Level','Attributes') @('Complete','CabinNest',1,1,0)
$taskDirectoryIds=@{''='INSTALLFOLDER'}
$taskFiles=@(Get-ChildItem -LiteralPath $taskPayload -Recurse -File | Sort-Object FullName)
foreach($taskFile in $taskFiles){if($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint){throw '安装包中含有链接'}}
$taskMarker=Join-Path $taskStage 'install-mode.json';[IO.File]::WriteAllText($taskMarker,'{"app":"CabinNest","mode":"installed","schema":1}',[Text.UTF8Encoding]::new($false))
$taskEntries=@($taskFiles | ForEach-Object {@{Source=$_.FullName;Relative=[IO.Path]::GetRelativePath($taskPayload,$_.FullName)}})+@(@{Source=$taskMarker;Relative='resources\app\install-mode.json'})
$taskDdf=[Collections.Generic.List[string]]::new()
foreach($taskLine in @('.OPTION EXPLICIT','.Set Cabinet=on','.Set Compress=on','.Set CompressionType=MSZIP','.Set MaxDiskSize=0','.Set CabinetNameTemplate=CabinNest.cab',('.Set DiskDirectoryTemplate="'+$taskStage+'"'),('.Set RptFileName="'+(Join-Path $taskStage 'cab.rpt')+'"'),('.Set InfFileName="'+(Join-Path $taskStage 'cab.inf')+'"'))){$taskDdf.Add($taskLine)}
$taskSequence=0;$taskMainId=$null;$taskManifest=@()
foreach($taskEntry in $taskEntries){
 $taskSequence++;$taskRelative=$taskEntry.Relative;$taskRelativeDirectory=[IO.Path]::GetDirectoryName($taskRelative)
 if(-not $taskDirectoryIds.ContainsKey($taskRelativeDirectory)){
  $taskParts=$taskRelativeDirectory.Split('\');$taskCurrent='';$taskParent='INSTALLFOLDER'
  foreach($taskPart in $taskParts){$taskCurrent=if($taskCurrent){$taskCurrent+'\'+$taskPart}else{$taskPart};if(-not $taskDirectoryIds.ContainsKey($taskCurrent)){$taskId='D'+(Stable-Guid $taskCurrent).Replace('-','').Trim('{}');Row 'Directory' @('Directory','Directory_Parent','DefaultDir') @($taskId,$taskParent,$taskPart);$taskDirectoryIds[$taskCurrent]=$taskId};$taskParent=$taskDirectoryIds[$taskCurrent]}
 }
 $taskFileId='F'+$taskSequence.ToString('D5');$taskComponent='C'+$taskSequence.ToString('D5');$taskSize=[int](Get-Item -LiteralPath $taskEntry.Source).Length
 Row 'Component' @('Component','ComponentId','Directory_','Attributes','KeyPath') @($taskComponent,(Stable-Guid ('component '+$taskRelative)),$taskDirectoryIds[$taskRelativeDirectory],256,$taskFileId)
 Row 'FeatureComponents' @('Feature_','Component_') @('Complete',$taskComponent)
 $taskFileVersion=if($taskRelative -eq 'CabinNest.exe'){$taskVersion}else{$null}
 Row 'File' @('File','Component_','FileName','FileSize','Version','Attributes','Sequence') @($taskFileId,$taskComponent,[IO.Path]::GetFileName($taskRelative),$taskSize,$taskFileVersion,512,$taskSequence)
 if(-not $taskFileVersion){$taskMd5=[Security.Cryptography.MD5]::HashData([IO.File]::ReadAllBytes($taskEntry.Source));Row 'MsiFileHash' @('File_','Options','HashPart1','HashPart2','HashPart3','HashPart4') @($taskFileId,0,[BitConverter]::ToInt32($taskMd5,0),[BitConverter]::ToInt32($taskMd5,4),[BitConverter]::ToInt32($taskMd5,8),[BitConverter]::ToInt32($taskMd5,12))}
 $taskCabSource=Join-Path $taskStage $taskFileId;Copy-Item -LiteralPath $taskEntry.Source -Destination $taskCabSource; $taskDdf.Add('"'+$taskCabSource+'" '+$taskFileId)
 $taskManifest+=@{path=$taskRelative;sha256=(Get-FileHash -LiteralPath $taskEntry.Source -Algorithm SHA256).Hash.ToLowerInvariant();size=$taskSize}
 if($taskRelative -eq 'CabinNest.exe'){$taskMainId=$taskComponent}
}
foreach($taskShortcut in @(@('DesktopShortcut','DesktopFolder'),@('MenuShortcut','CabinNestMenuFolder'))){Row 'Shortcut' @('Shortcut','Directory_','Name','Component_','Target','Description','ShowCmd','WkDir') @($taskShortcut[0],$taskShortcut[1],'CabinNest',$taskMainId,'[INSTALLFOLDER]CabinNest.exe','CabinNest 项目资料与待办',1,'INSTALLFOLDER')}
Row 'CreateFolder' @('Directory_','Component_') @('CabinNestMenuFolder',$taskMainId)
Row 'Upgrade' @('UpgradeCode','VersionMax','Attributes','ActionProperty') @($taskUpgradeCode,$taskVersion,1,'OLDPRODUCTS')
Row 'Upgrade' @('UpgradeCode','VersionMin','Attributes','ActionProperty') @($taskUpgradeCode,$taskVersion,2,'NEWERPRODUCTS')
Row 'LaunchCondition' @('Condition','Description') @('NOT NEWERPRODUCTS','本机已安装更新版本的 CabinNest。')
Row 'LaunchCondition' @('Condition','Description') @('VersionNT64','CabinNest 需要 64 位 Windows。')
Row 'CustomAction' @('Action','Type','Source','Target') @('SetInstallLocation',51,'ARPINSTALLLOCATION','[INSTALLFOLDER]')
$taskActions=@(@('FindRelatedProducts',25),@('LaunchConditions',100),@('CostInitialize',800),@('FileCost',900),@('CostFinalize',1000),@('SetInstallLocation',1001),@('MigrateFeatureStates',1200),@('InstallValidate',1400),@('InstallInitialize',1500),@('RemoveExistingProducts',1510),@('ProcessComponents',1600),@('UnpublishFeatures',1800),@('RemoveShortcuts',3200),@('RemoveFiles',3500),@('RemoveFolders',3600),@('CreateFolders',3700),@('InstallFiles',4000),@('CreateShortcuts',4500),@('RegisterUser',6000),@('RegisterProduct',6100),@('PublishFeatures',6300),@('PublishProduct',6400),@('InstallFinalize',6600))
foreach($taskAction in $taskActions){Row 'InstallExecuteSequence' @('Action','Sequence') $taskAction}
foreach($taskAction in @(@('FindRelatedProducts',25),@('LaunchConditions',100),@('CostInitialize',800),@('FileCost',900),@('CostFinalize',1000),@('SetInstallLocation',1001),@('WelcomeDlg',1230),@('ProgressDlg',1250),@('ExecuteAction',1300),@('ExitDialog',-1))){$taskCondition=if($taskAction[0] -eq 'WelcomeDlg'){'NOT Installed'}else{$null};Row 'InstallUISequence' @('Action','Condition','Sequence') @($taskAction[0],$taskCondition,$taskAction[1])}
Row 'TextStyle' @('TextStyle','FaceName','Size','Color','StyleBits') @('UiFont','Microsoft YaHei',9,0,0)
Row 'TextStyle' @('TextStyle','FaceName','Size','Color','StyleBits') @('TitleFont','Microsoft YaHei',14,0,1)
Row 'Dialog' @('Dialog','HCentering','VCentering','Width','Height','Attributes','Title','Control_First','Control_Default','Control_Cancel') @('WelcomeDlg',50,50,370,220,3,'安装 CabinNest','Install','Install','Cancel')
Row 'Dialog' @('Dialog','HCentering','VCentering','Width','Height','Attributes','Title') @('ProgressDlg',50,50,370,180,1,'CabinNest')
Row 'Dialog' @('Dialog','HCentering','VCentering','Width','Height','Attributes','Title','Control_First','Control_Default','Control_Cancel') @('ExitDialog',50,50,370,200,3,'CabinNest','Finish','Finish','Finish')
function Control($Dialog,$Id,$Type,$X,$Y,$Width,$Height,$Text,$Next=$null){Row 'Control' @('Dialog_','Control','Type','X','Y','Width','Height','Attributes','Text','Control_Next') @($Dialog,$Id,$Type,$X,$Y,$Width,$Height,3,$Text,$Next)}
Control 'WelcomeDlg' 'Title' 'Text' 20 20 330 30 '{\TitleFont}CabinNest [ProductVersion]'
Control 'WelcomeDlg' 'Description' 'Text' 20 62 330 90 '安装到当前用户的应用程序目录，并创建桌面和开始菜单快捷方式。项目资料保存在独立目录，升级和卸载均保留资料。'
Control 'WelcomeDlg' 'Install' 'PushButton' 200 178 70 24 '安装' 'Cancel'
Control 'WelcomeDlg' 'Cancel' 'PushButton' 280 178 70 24 '取消' 'Install'
Control 'ProgressDlg' 'Title' 'Text' 20 20 330 24 '{\TitleFont}正在处理 CabinNest'
Control 'ProgressDlg' 'ActionText' 'Text' 20 70 330 24 '请稍候…'
Control 'ProgressDlg' 'Progress' 'ProgressBar' 20 115 330 15 ''
Control 'ExitDialog' 'Title' 'Text' 20 20 330 30 '{\TitleFont}操作已完成'
Control 'ExitDialog' 'Description' 'Text' 20 65 330 70 '可从桌面或开始菜单打开 CabinNest。资料始终保存在独立目录。'
Control 'ExitDialog' 'Finish' 'PushButton' 280 155 70 24 '完成'
foreach($taskEvent in @(@('WelcomeDlg','Install','EndDialog','Return'),@('WelcomeDlg','Cancel','EndDialog','Exit'),@('ExitDialog','Finish','EndDialog','Return'))){Row 'ControlEvent' @('Dialog_','Control_','Event','Argument','Condition','Ordering') @($taskEvent[0],$taskEvent[1],$taskEvent[2],$taskEvent[3],'1',1)}
Row 'EventMapping' @('Dialog_','Control_','Event','Attribute') @('ProgressDlg','Progress','SetProgress','Progress')
Row 'EventMapping' @('Dialog_','Control_','Event','Attribute') @('ProgressDlg','ActionText','ActionText','Text')
[IO.File]::WriteAllLines((Join-Path $taskStage 'payload.ddf'),$taskDdf,[Text.Encoding]::Default)
& "$env:WINDIR\System32\makecab.exe" /F (Join-Path $taskStage 'payload.ddf') | Out-File -LiteralPath (Join-Path $taskStage 'makecab.log')
if($LASTEXITCODE -ne 0){throw '生成安装压缩包失败'}
Row 'Media' @('DiskId','LastSequence','Cabinet') @(1,$taskSequence,'#CabinNest.cab')
$taskView=Call-Com $taskDb 'OpenView' @('INSERT INTO `_Streams` (`Name`,`Data`) VALUES (?,?)');$taskRecord=Call-Com $taskInstaller 'CreateRecord' @(2)
Set-Com $taskRecord 'StringData' @(1,'CabinNest.cab');Call-Com $taskRecord 'SetStream' @(2,(Join-Path $taskStage 'CabinNest.cab'))|Out-Null;Call-Com $taskView 'Execute' @($taskRecord)|Out-Null;Call-Com $taskView 'Close' @()|Out-Null
$taskSummary=Call-Com $taskDb 'SummaryInformation' @(20)
foreach($taskProperty in @(@(1,936),@(2,'CabinNest Setup'),@(3,'CabinNest'),@(4,'CabinNest'),@(7,'x64;2052'),@(9,('{'+[guid]::NewGuid().ToString().ToUpperInvariant()+'}')),@(14,500),@(15,10),@(18,'CabinNest MSI Builder'),@(19,2))){Set-Com $taskSummary 'Property' $taskProperty}
Call-Com $taskSummary 'Persist' @()|Out-Null;Call-Com $taskDb 'Commit' @()|Out-Null
foreach($taskObject in @($taskSummary,$taskRecord,$taskView,$taskDb,$taskInstaller)){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskObject)}
[GC]::Collect();[GC]::WaitForPendingFinalizers()
@{version=$taskVersion;productCode=$taskProductCode;upgradeCode=$taskUpgradeCode;files=$taskManifest;dataIncluded=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskOutput 'package-manifest.json') -Encoding utf8
Get-FileHash -LiteralPath $taskMsi -Algorithm SHA256 | Select-Object Path,Hash
Write-Output "MSI_READY $taskMsi"
