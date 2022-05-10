// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CompoundButton, Text, IButtonProps, useTheme, Checkbox } from "@fluentui/react";
import { Stack } from "@mui/material";
import { useMemo } from "react";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";
import TextMiddleTruncate from "@foxglove/studio-base/panels/ThreeDimensionalViz/TopicTree/TextMiddleTruncate";

import ActionList from "./ActionList";
import { OpenDialogViews } from "./types";

const HELP_ITEMS: IButtonProps[] = [
  {
    id: "slack",
    href: "https://foxglove.dev/slack?utm_source=studio&utm_medium=open-dialog",
    target: "_blank",
    children: "Join our Slack community",
  },
  {
    id: "docs",
    href: "https://foxglove.dev/docs?utm_source=studio&utm_medium=open-dialog",
    target: "_blank",
    children: "Browse docs",
  },
  {
    id: "github",
    href: "https://github.com/foxglove/studio/issues/",
    target: "_blank",
    children: "Report a bug or request a feature",
  },
];

const CONTACT_ITEMS = [
  {
    id: "feedback",
    href: "https://foxglove.dev/contact/",
    target: "_blank",
    children: "Give feedback",
  },
  {
    id: "demo",
    href: "https://foxglove.dev/demo/",
    target: "_blank",
    children: "Schedule a demo",
  },
];

export type IStartProps = {
  onSelectView: (newValue: OpenDialogViews) => void;
};

export default function Start(props: IStartProps): JSX.Element {
  const { onSelectView } = props;
  const theme = useTheme();
  const { recentSources, selectRecent } = usePlayerSelection();

  const [showOnStartup = true, setShowOnStartup] = useAppConfigurationValue<boolean>(
    AppSetting.SHOW_OPEN_DIALOG_ON_STARTUP,
  );

  const buttonStyles = useMemo(
    () => ({
      root: {
        width: 340,
        maxWidth: "none",
      },
      rootHovered: { backgroundColor: theme.palette.neutralLighterAlt },
      rootPressed: { backgroundColor: theme.palette.neutralLighter },
      flexContainer: { alignItems: "center" },
      description: { whiteSpace: "pre-line" },
      descriptionHovered: { color: theme.semanticColors.bodySubtext },
      icon: {
        marginRight: theme.spacing.m,
        marginLeft: theme.spacing.s1,
        color: theme.palette.themePrimary,

        "> span": { display: "flex" },
        svg: { height: "1em", width: "1em" },
      },
      labelHovered: {
        color: theme.palette.themePrimary,
      },
    }),
    [theme],
  );

  const startItems: IButtonProps[] = useMemo(() => {
    return [
      {
        id: "sample-data",
        children: "Wondering what CARLAFox is? Start here!",
        secondaryText: "Explore pre-recorded data",
        iconProps: { iconName: "BookStar" },
        onClick: () => onSelectView("demo"),
      },
      {
        id: "live-demo",
        children: "Want to dive deeper and reprogram the simulation?",
        secondaryText: "Explore a live CARLAFox demo",
        iconProps: { iconName: "BookPulse" },
        onClick: () => {
          window.location.href = "http://viking.kurg.org:8080/";
        },
      },
    ];
  }, [onSelectView]);

  const recentItems: IButtonProps[] = useMemo(() => {
    return recentSources.map((recent) => {
      return {
        id: recent.id,
        children: (
          <Stack
            direction="row"
            sx={{ overflow: "hidden", "&:hover": { color: theme.palette.themeDark } }}
          >
            <Text
              variant="small"
              styles={{
                root: {
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  color: "inherit",
                  paddingRight: theme.spacing.s1,
                },
              }}
            >
              <TextMiddleTruncate text={recent.title} />
            </Text>
            {recent.label && (
              <Text
                variant="small"
                styles={{
                  root: {
                    whiteSpace: "nowrap",
                    color: theme.palette.neutralSecondaryAlt,
                  },
                }}
              >
                {recent.label}
              </Text>
            )}
          </Stack>
        ),
        onClick: () => selectRecent(recent.id),
      };
    });
  }, [recentSources, selectRecent, theme]);

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={4}>
        {/* Left column */}
        <Stack flexGrow={1} spacing={2}>
          <Text variant="large" styles={{ root: { color: theme.semanticColors.bodySubtext } }}>
            Open data source
          </Text>
          <Stack spacing={1}>
            {startItems.map(({ id, ...item }) => (
              <CompoundButton {...item} key={id} id={id} styles={buttonStyles} />
            ))}
          </Stack>
        </Stack>

        {/* Right column */}
        <Stack flexGrow={1} minWidth={0} spacing={2.5}>
          {recentItems.length > 0 && <ActionList title="Recent" items={recentItems} />}
          <ActionList title="Help" items={HELP_ITEMS} />
          <ActionList title="Contact" items={CONTACT_ITEMS} />
        </Stack>
      </Stack>
      <Checkbox
        label="Show on startup"
        checked={showOnStartup}
        onChange={async (_, checked) => {
          await setShowOnStartup(checked);
        }}
      />
    </Stack>
  );
}
