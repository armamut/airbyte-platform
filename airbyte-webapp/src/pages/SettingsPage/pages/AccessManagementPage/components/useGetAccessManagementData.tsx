import { useCurrentWorkspace, useListUsersInOrganization, useListUsersInWorkspace } from "core/api";
import { OrganizationUserRead, PermissionRead, PermissionType, WorkspaceUserRead } from "core/api/types/AirbyteClient";
import { useIntent } from "core/utils/rbac";

export type ResourceType = "workspace" | "organization" | "instance";

export const permissionStringDictionary: Record<PermissionType, Record<string, string>> = {
  instance_admin: { resource: "resource.instance", role: "role.admin" },
  organization_admin: { resource: "resource.organization", role: "role.admin" },
  organization_editor: { resource: "resource.organization", role: "role.editor" },
  organization_reader: { resource: "resource.organization", role: "role.reader" },
  organization_member: { resource: "resource.organization", role: "role.member" },
  workspace_admin: { resource: "resource.workspace", role: "role.admin" },
  workspace_owner: { resource: "resource.workspace", role: "role.admin" },
  workspace_editor: { resource: "resource.workspace", role: "role.editor" },
  workspace_reader: { resource: "resource.workspace", role: "role.reader" },
};

interface PermissionDescription {
  id: string;
  values: Record<"resourceType", ResourceType>;
}
export const permissionDescriptionDictionary: Record<PermissionType, PermissionDescription> = {
  instance_admin: { id: "role.admin.description", values: { resourceType: "instance" } },
  organization_admin: { id: "role.admin.description", values: { resourceType: "organization" } },
  organization_editor: { id: "role.editor.description", values: { resourceType: "organization" } },
  organization_reader: { id: "role.reader.description", values: { resourceType: "organization" } },
  organization_member: { id: "role.member.description", values: { resourceType: "organization" } },
  workspace_admin: { id: "role.admin.description", values: { resourceType: "workspace" } },
  workspace_owner: { id: "role.admin.description", values: { resourceType: "workspace" } }, // is not and should not be referenced in code.  required by types but will be deprecated soon.
  workspace_editor: { id: "role.editor.description", values: { resourceType: "workspace" } },
  workspace_reader: { id: "role.reader.description", values: { resourceType: "workspace" } },
};
export const tableTitleDictionary: Record<ResourceType, string> = {
  workspace: "settings.accessManagement.workspace",
  organization: "settings.accessManagement.organization",
  instance: "settings.accessManagement.instance",
};
export const permissionsByResourceType: Record<ResourceType, PermissionType[]> = {
  workspace: [
    PermissionType.workspace_admin,
    // PermissionType.workspace_editor,
    PermissionType.workspace_reader,
  ],
  organization: [
    PermissionType.organization_admin,
    // PermissionType.organization_editor, -- role not supported in MVP
    // PermissionType.organization_reader, -- role not supported in MVP
    PermissionType.organization_member,
  ],
  instance: [PermissionType.instance_admin],
};

export interface NextAccessUserRead {
  userId: string;
  email: string;
  name?: string;
  workspacePermission?: PermissionRead;
  organizationPermission?: PermissionRead;
}

export interface AccessUsers {
  workspace?: { users: WorkspaceUserRead[]; usersToAdd: OrganizationUserRead[] };
  organization?: { users: OrganizationUserRead[]; usersToAdd: [] };
}

export interface NextAccessUsers {
  workspace?: { users: NextAccessUserRead[]; usersToAdd: OrganizationUserRead[] };
}

export const useGetWorkspaceAccessUsers = (): AccessUsers => {
  const workspace = useCurrentWorkspace();
  const canListOrganizationUsers = useIntent("ListOrganizationMembers", { organizationId: workspace.organizationId });
  const workspaceUsers: WorkspaceUserRead[] = useListUsersInWorkspace(workspace.workspaceId).users;
  const organizationUsers =
    useListUsersInOrganization(workspace.organizationId ?? "", canListOrganizationUsers)?.users ?? [];

  return {
    workspace: {
      users: workspaceUsers,
      usersToAdd: organizationUsers.filter(
        (user) =>
          user.permissionType === "organization_member" &&
          !workspaceUsers.find((workspaceUser) => workspaceUser.userId === user.userId)
      ),
    },
    organization: {
      users: organizationUsers.filter((user) => user.permissionType !== "organization_member"),
      usersToAdd: [],
    },
  };
};

export const useNextGetWorkspaceAccessUsers = (): NextAccessUsers => {
  const workspace = useCurrentWorkspace();
  const organizationUsers = useListUsersInOrganization(workspace.organizationId ?? "").users;

  const workspaceUsers: NextAccessUserRead[] = useListUsersInWorkspace(workspace.workspaceId).users.map(
    (workspaceUser) => {
      const organizationUser = organizationUsers.find((user) => user.userId === workspaceUser.userId);

      return {
        userId: workspaceUser.userId,
        name: workspaceUser.name,
        email: workspaceUser.email,
        workspacePermission: {
          workspaceId: workspaceUser.workspaceId,
          permissionType: workspaceUser.permissionType,
          permissionId: workspaceUser.permissionId,
          userId: workspaceUser.userId,
        },
        organizationPermission: organizationUser
          ? {
              organizationId: organizationUser?.organizationId,
              permissionType: organizationUser?.permissionType,
              permissionId: organizationUser?.permissionId,
              userId: organizationUser?.userId,
            }
          : undefined,
      };
    }
  );

  const orgUsers: NextAccessUserRead[] = organizationUsers
    .map((organizationUser) => {
      if (
        workspaceUsers.some((workspaceUser) => workspaceUser.userId === organizationUser.userId) ||
        organizationUser.permissionType === "organization_member"
      ) {
        return null; // Skip if user already exists in workspaceUsers OR if their permission doesn't grant them access to the workspace
      }

      return {
        userId: organizationUser.userId,
        email: organizationUser.email,
        name: organizationUser.name,
        organizationPermission: {
          organizationId: organizationUser.organizationId,
          permissionType: organizationUser.permissionType,
          permissionId: organizationUser.permissionId,
          userId: organizationUser.userId,
        },
      };
    })
    .filter(Boolean) as NextAccessUserRead[];

  const orgUsersToAdd = organizationUsers
    .filter(
      (user) =>
        user.permissionType === "organization_member" &&
        !workspaceUsers.find((workspaceUser) => workspaceUser.userId === user.userId)
    )
    .map((orgUser) => ({
      ...orgUser,
      organizationPermissionType: orgUser.permissionType,
      organizationPermissionId: orgUser.permissionId,
    }));

  return { workspace: { users: [...workspaceUsers, ...orgUsers], usersToAdd: orgUsersToAdd } };
};

export const useGetOrganizationAccessUsers = (): AccessUsers => {
  const workspace = useCurrentWorkspace();
  const organizationUsers = useListUsersInOrganization(workspace.organizationId ?? "").users;
  return {
    organization: { users: organizationUsers, usersToAdd: [] },
  };
};

export const getHighestPermissionType = (
  user: NextAccessUserRead,
  resourceType: "workspace" | "organization" | "instance"
) => {
  const orgPermissionType = user.organizationPermission ? user.organizationPermission.permissionType : undefined;
  const workspacePermissionType = user.workspacePermission ? user.workspacePermission.permissionType : undefined;

  switch (resourceType) {
    case "instance":
      return undefined;
    case "organization":
      switch (orgPermissionType) {
        case "organization_admin":
          return "admin";
        case "organization_editor":
          return "editor";
        case "organization_reader":
          return "reader";
        default:
          return "member";
      }
    default:
      switch (true) {
        case workspacePermissionType === "workspace_admin" || orgPermissionType === "organization_admin":
          return "admin";
        case workspacePermissionType === "workspace_editor" || orgPermissionType === "organization_editor":
          return "editor";
        case workspacePermissionType === "workspace_reader" || orgPermissionType === "organization_reader":
          return "reader";
        default:
          return "member";
      }
  }
};
