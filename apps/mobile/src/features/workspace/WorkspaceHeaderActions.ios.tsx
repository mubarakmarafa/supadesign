import { useNavigation, type ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { NativeHeaderToolbar } from "../../native/StackHeader";
import { dispatchHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import type { WorkspaceDockFilterMenu } from "./WorkspaceDock.types";

function invokeFilterAction(menu: WorkspaceDockFilterMenu, id: string | undefined) {
  menu.onPressAction({ nativeEvent: { event: id ?? "" } });
}

export function WorkspaceHeaderActions(props: { readonly filterMenu?: WorkspaceDockFilterMenu }) {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const filterMenu = props.filterMenu;
  const filterIcon = filterMenu?.customized
    ? "line.3.horizontal.decrease.circle.fill"
    : "line.3.horizontal.decrease.circle";

  return (
    <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Button
        accessibilityLabel="Settings"
        icon="gearshape"
        onPress={() =>
          navigation.navigate("SettingsSheet", {
            screen: "SettingsContent",
            params: { screen: "Settings" },
          })
        }
      />
      {filterMenu ? (
        <NativeHeaderToolbar.Menu
          accessibilityLabel={filterMenu.accessibilityLabel}
          icon={filterIcon}
        >
          {filterMenu.actions.map((action) =>
            action.subactions ? (
              <NativeHeaderToolbar.Menu
                key={action.id ?? action.title}
                title={action.title}
                inline={action.displayInline}
              >
                {action.subactions.map((subaction) => (
                  <NativeHeaderToolbar.MenuAction
                    key={subaction.id ?? subaction.title}
                    disabled={subaction.attributes?.disabled}
                    destructive={subaction.attributes?.destructive}
                    isOn={subaction.state === "on"}
                    subtitle={subaction.subtitle}
                    onPress={() => invokeFilterAction(filterMenu, subaction.id)}
                  >
                    {subaction.title}
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            ) : (
              <NativeHeaderToolbar.MenuAction
                key={action.id ?? action.title}
                disabled={action.attributes?.disabled}
                destructive={action.attributes?.destructive}
                isOn={action.state === "on"}
                subtitle={action.subtitle}
                onPress={() => invokeFilterAction(filterMenu, action.id)}
              >
                {action.title}
              </NativeHeaderToolbar.MenuAction>
            ),
          )}
        </NativeHeaderToolbar.Menu>
      ) : null}
      <NativeHeaderToolbar.Button
        accessibilityLabel="Focus search"
        icon="magnifyingglass"
        onPress={() => dispatchHardwareKeyboardCommand("focusSearch")}
      />
    </NativeHeaderToolbar>
  );
}
