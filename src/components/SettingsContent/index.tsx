import { clsx } from "clsx/lite";
import { observer } from "mobx-react-lite";

import "./styles.css";

import { About } from "#components/About";
import { ColorPicker } from "#components/ColorPicker";
import { CaretDown } from "#components/icons/CaretDown.tsx";
import { wallpapers } from "#lib/wallpapers";
import { colorPicker } from "#stores/useColorPicker";
import { settings } from "#stores/useSettings";
import { Switch } from "./Switch.tsx";

export const SettingsContent = observer(function SettingsContent() {
  const {
    handleCustomColor,
    handleCustomImage,
    handleDialSize,
    handleMaxColumns,
    handleNewTab,
    handleExternalFaviconProviders,
    handleEnableSync,
    handleColumnGap,
    handleRowGap,
    handleTitleOpacity,
    handleTitleSize,
    handleThemeOption,
    handleWallpaper,
    handleShowBookmarkSectionBar,
    handleRememberLastFolder,
    resetSettings,
    restoreFromJSON,
    saveToJSON,
  } = settings;

  const wallpaperColors = [
    "Light",
    "Dark",
    "Brown",
    "Blue",
    "Yellow",
    "Green",
    "Pink",
  ];

  return (
    <>
      <div className="setting-wrapper">
        <div className="setting-title" id="background-title">
          Background
        </div>
        <div className="setting-description" id="background-description">
          Choose a background color or image.
        </div>
        <div className="setting-option wallpapers">
          {/* Color wallpapers */}
          {wallpaperColors.map((wallpaper) => (
            <button
              type="button"
              id={`${wallpaper.toLowerCase()}-wallpaper`}
              className={clsx(
                "wallpaper-button",
                settings.wallpaper === `${wallpaper.toLowerCase()}-wallpaper`
                  ? "selected"
                  : false,
              )}
              title={wallpaper}
              onClick={() => {
                handleWallpaper(`${wallpaper.toLowerCase()}-wallpaper`);
              }}
              key={wallpaper}
            />
          ))}
          {/* Image wallpapers from all categories */}
          {wallpapers.map(({ id, title, thumbnail }) => (
            <button
              type="button"
              className={clsx(
                "wallpaper-button",
                settings.wallpaper === id ? "selected" : false,
              )}
              style={{
                backgroundImage: `url(${thumbnail})`,
              }}
              title={title}
              onClick={() => {
                handleWallpaper(id);
              }}
              key={id}
            />
          ))}
          {/* Custom Color - only show if color is set */}
          {settings.customColor && (
            <button
              type="button"
              className={clsx(
                "wallpaper-button",
                settings.wallpaper === "custom-color" ? " selected" : false,
              )}
              style={{
                backgroundColor: settings.customColor as string,
              }}
              title="Custom Color"
              onClick={() => {
                handleWallpaper("custom-color");
              }}
            />
          )}
          {/* Custom Image - only show if image is set */}
          {settings.customImage && (
            <button
              type="button"
              id="custom-image"
              className={clsx(
                "wallpaper-button",
                settings.wallpaper === "custom-image" ? " selected" : false,
              )}
              style={{
                backgroundImage: `url(${settings.customImage})`,
              }}
              title="Custom Image"
              onClick={() => {
                handleWallpaper("custom-image");
              }}
            />
          )}
        </div>
        {/* Custom selection buttons */}
        <div className="background-buttons">
          <button
            className="btn defaultBtn upload-image-btn"
            aria-pressed={settings.wallpaper === "custom-image"}
            onClick={handleCustomImage}
          >
            Upload Image
          </button>
          <button
            className="btn defaultBtn"
            aria-pressed={settings.wallpaper === "bing-wallpaper"}
            onClick={() => handleWallpaper("bing-wallpaper")}
          >
            Bing Image
          </button>
        </div>
        {settings.wallpaper === "bing-wallpaper" && settings.bingDebugInfo && (
          <div
            style={{
              fontSize: "10px",
              opacity: 0.6,
              marginTop: "-15px",
              marginBottom: "15px",
              textAlign: "center",
            }}
          >
            Status: {settings.bingDebugInfo}
          </div>
        )}
        {colorPicker.isOpen && (
          <ColorPicker
            {...{
              color: settings.customColor as string,
              handler: handleCustomColor,
              label: "Background Color",
            }}
          />
        )}
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="remember-last-folder-title">
            Remember last opened folder
          </div>
          <div
            className="setting-description"
            id="remember-last-folder-description"
          >
            Reopen the last folder after restart. URL hash on this page wins if
            set.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="remember-last-folder-title"
            aria-describedby="remember-last-folder-description"
            onClick={() =>
              handleRememberLastFolder(!settings.rememberLastFolder)
            }
            className="switch-root"
            checked={settings.rememberLastFolder as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="color-scheme-title">
            Color Scheme
          </div>
          <div className="setting-description" id="color-scheme-description">
            Choose the color scheme for Favicon Speed Dial.
          </div>
        </div>
        <div className="setting-option select">
          <select
            onChange={(e) => handleThemeOption(e.target.value)}
            value={settings.themeOption}
            className="input"
            aria-labelledby="color-scheme-title"
            aria-describedby="color-scheme-description"
          >
            {["Automatic", "Light", "Dark"].map((t) => (
              <option value={t === "Automatic" ? "System Theme" : t} key={t}>
                {t}
              </option>
            ))}
          </select>
          <CaretDown />
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="open-new-tabs-title">
            Open in New Tab
          </div>
          <div className="setting-description" id="open-new-tabs-description">
            Open each bookmark in a new tab.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="open-new-tabs-title"
            aria-describedby="open-new-tabs-description"
            onClick={() => handleNewTab(!settings.newTab)}
            className="switch-root"
            checked={settings.newTab as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="external-favicon-providers-title">
            External favicon providers
          </div>
          <div
            className="setting-description"
            id="external-favicon-providers-description"
          >
            Use third-party hosts (e.g. Google) for sharper icons. Off:
            first-party + Chrome favicon cache only.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="external-favicon-providers-title"
            aria-describedby="external-favicon-providers-description"
            onClick={() =>
              handleExternalFaviconProviders(
                !settings.enableExternalFaviconProviders,
              )
            }
            className="switch-root"
            checked={settings.enableExternalFaviconProviders as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="sync-settings-title">
            Sync Settings
          </div>
          <div className="setting-description" id="sync-settings-description">
            Synchronize your settings across devices when signed into your
            browser account.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="sync-settings-title"
            aria-describedby="sync-settings-description"
            onClick={() => handleEnableSync(!settings.enableSync)}
            className="switch-root"
            checked={settings.enableSync as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="square-dials-title">
            Square Dials
          </div>
          <div className="setting-description" id="square-dials-description">
            Toggle between square and rounded speed dial icons.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="square-dials-title"
            aria-describedby="square-dials-description"
            onClick={() => settings.handleSquareDials(!settings.squareDials)}
            className="switch-root"
            checked={settings.squareDials as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="bookmark-section-bar-title">
            Bookmark section bar
          </div>
          <div
            className="setting-description"
            id="bookmark-section-bar-description"
          >
            Top bar to jump between Bookmarks bar, Other bookmarks, etc., when
            available.
          </div>
        </div>
        <div className="setting-option toggle">
          <Switch
            aria-labelledby="bookmark-section-bar-title"
            aria-describedby="bookmark-section-bar-description"
            onClick={() =>
              handleShowBookmarkSectionBar(!settings.showBookmarkSectionBar)
            }
            className="switch-root"
            checked={settings.showBookmarkSectionBar as boolean}
          >
            <span className="switch-thumb" />
          </Switch>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="max-cols-title">
            Maximum Columns
          </div>
          <div className="setting-description" id="max-cols-description">
            Choose the maximum number of columns to display.
          </div>
        </div>
        <div className="setting-option select">
          <select
            onChange={(e) => handleMaxColumns(e.target.value)}
            value={settings.maxColumns as string}
            className="input"
            aria-labelledby="max-cols-title"
            aria-describedby="max-cols-description"
          >
            {[
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "10",
              "11",
              "12",
              "Unlimited",
            ].map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </select>
          <CaretDown />
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="dial-size-title">
            Dial Size
          </div>
          <div className="setting-description" id="dial-size-description">
            Choose the size of the speed dial icons.
          </div>
        </div>
        <div className="setting-option select">
          <select
            onChange={(e) => handleDialSize(e.target.value)}
            value={settings.dialSize as string}
            className="input"
            aria-labelledby="dial-size-title"
            aria-describedby="dial-size-description"
          >
            {[
              { label: "Really Tiny", value: "really-tiny" },
              { label: "Tiny", value: "tiny" },
              { label: "Small", value: "small" },
              { label: "Medium", value: "medium" },
              { label: "Large", value: "large" },
              { label: "Huge", value: "huge" },
              { label: "Scale to Fit", value: "scale" },
            ].map(({ label, value }) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <CaretDown />
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="column-gap-title">
            Column Gap
          </div>
          <div className="setting-description" id="column-gap-description">
            Adjust the horizontal space between dials.
          </div>
        </div>
        <div className="setting-option slider">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={settings.columnGap}
            onChange={(e) => handleColumnGap(parseInt(e.target.value))}
            aria-labelledby="column-gap-title"
            aria-describedby="column-gap-description"
          />
          <span className="slider-value">{settings.columnGap}px</span>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="row-gap-title">
            Row Gap
          </div>
          <div className="setting-description" id="row-gap-description">
            Adjust the vertical space between dials.
          </div>
        </div>
        <div className="setting-option slider">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={settings.rowGap}
            onChange={(e) => handleRowGap(parseInt(e.target.value))}
            aria-labelledby="row-gap-title"
            aria-describedby="row-gap-description"
          />
          <span className="slider-value">{settings.rowGap}px</span>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="title-opacity-title">
            Title Background Opacity
          </div>
          <div className="setting-description" id="title-opacity-description">
            Adjust the transparency of the bookmark title backgrounds.
          </div>
        </div>
        <div className="setting-option slider">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings.titleOpacity}
            onChange={(e) => handleTitleOpacity(parseFloat(e.target.value))}
            aria-labelledby="title-opacity-title"
            aria-describedby="title-opacity-description"
          />
          <span className="slider-value">
            {Math.round(settings.titleOpacity * 100)}%
          </span>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="title-size-title">
            Title Font Size
          </div>
          <div className="setting-description" id="title-size-description">
            Adjust the text size of the bookmark titles.
          </div>
        </div>
        <div className="setting-option slider">
          <input
            type="range"
            min="10"
            max="32"
            step="1"
            value={settings.titleSize}
            onChange={(e) => handleTitleSize(parseInt(e.target.value))}
            aria-labelledby="title-size-title"
            aria-describedby="title-size-description"
          />
          <span className="slider-value">{settings.titleSize}px</span>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="reset-backup-restore-title">
            Backup and Restore
          </div>
          <div
            className="setting-description"
            id="reset-backup-restore-description"
          >
            Save a file with all your settings.
          </div>
        </div>
        <div className="setting-option backup-restore">
          <button type="button" className="btn defaultBtn" onClick={saveToJSON}>
            Backup
          </button>
          <button
            type="button"
            className="btn defaultBtn"
            onClick={restoreFromJSON}
          >
            Restore
          </button>
        </div>
      </div>
      <div className="setting-wrapper setting-group">
        <div className="setting-label">
          <div className="setting-title" id="reset-settings-title">
            Reset Settings
          </div>
          <div className="setting-description" id="reset-settings-description">
            Reset all settings to their defaults.
          </div>
        </div>
        <div className="setting-option reset">
          <button
            type="button"
            className="btn defaultBtn"
            onClick={resetSettings}
          >
            Reset
          </button>
        </div>
      </div>
      <div className="setting-wrapper about">
        <About />
      </div>
    </>
  );
});
