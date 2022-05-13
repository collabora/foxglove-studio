// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CompoundButton, IButtonProps, useTheme } from "@fluentui/react";
import { Stack } from "@mui/material";
import { useMemo } from "react";

import { OpenDialogViews } from "./types";

export type IStartProps = {
  onSelectView: (newValue: OpenDialogViews) => void;
};

export default function Start(props: IStartProps): JSX.Element {
  const { onSelectView } = props;
  const theme = useTheme();

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

  return (
    <Stack
      flexGrow={1}
      spacing={2}
      direction="row"
      justifyContent="space-evenly"
      alignItems="center"
      p="25px"
    >
      {startItems.map(({ id, ...item }) => (
        <CompoundButton {...item} key={id} id={id} styles={buttonStyles} />
      ))}
    </Stack>
  );
}
