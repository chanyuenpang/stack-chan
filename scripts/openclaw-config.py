#!/usr/bin/env python3
"""
openclaw-config.py - Safe configuration editor for openclaw.json

Operates on agent IDs (not array indices) to avoid index shifting issues.
All write operations include automatic backup and JSON validation.

Usage:
    python3 openclaw-config.py <domain> <action> [args...] [options]

Domains: agents, skills, bindings, channels, mcp, show, validate, backup
"""

import sys
import os
import json
import shutil
import argparse
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Config path resolution
# ---------------------------------------------------------------------------

DEFAULT_CONFIG_PATH = os.path.expanduser("~/.openclaw/openclaw.json")


def resolve_config_path():
    return os.environ.get("OPENCLAW_CONFIG_PATH", DEFAULT_CONFIG_PATH)


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(config, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
        f.write("\n")


def backup_config(path, action_desc=""):
    """Create backup in backups/{date}/ directory with action keyword in filename.
    
    Args:
        path: Path to the config file
        action_desc: Short action description (e.g., "agents-add-skill", "mcp-add")
    
    Returns:
        Path to the backup file
    """
    ts = datetime.now().strftime("%H%M%S")
    date_str = datetime.now().strftime("%Y-%m-%d")
    
    # Create backup directory: same parent as config file, /backups/{date}/
    config_dir = os.path.dirname(path)
    backup_dir = os.path.join(config_dir, "backups", date_str)
    os.makedirs(backup_dir, exist_ok=True)
    
    # Build filename with action keyword
    config_name = os.path.basename(path)  # e.g., "openclaw.json"
    name_base, ext = os.path.splitext(config_name)  # "openclaw", ".json"
    
    if action_desc:
        # Sanitize action_desc for filename (replace invalid chars)
        safe_action = action_desc.replace(" ", "-").replace("/", "-")
        backup_name = f"{name_base}.{ts}-{safe_action}{ext}.bak"
    else:
        backup_name = f"{name_base}.{ts}{ext}.bak"
    
    backup_path = os.path.join(backup_dir, backup_name)
    shutil.copy2(path, backup_path)
    return backup_path


# ---------------------------------------------------------------------------
# Agent helpers
# ---------------------------------------------------------------------------

def find_agent_index(config, agent_id):
    """Find agent index by ID. Returns (index, agent) or (None, None)."""
    agents_list = config.get("agents", {}).get("list", [])
    for i, agent in enumerate(agents_list):
        if agent.get("id") == agent_id:
            return i, agent
    return None, None


def get_or_create_list(config, *keys):
    """Traverse nested dict/list by keys, create missing containers."""
    obj = config
    for key in keys:
        if isinstance(obj, dict):
            if key not in obj:
                obj[key] = {} if keys.index(key) < len(keys) - 1 else []
            obj = obj[key]
        elif isinstance(obj, list):
            obj = obj[int(key)]
        else:
            raise ValueError(f"Cannot traverse into {type(obj)} at key '{key}'")
    return obj


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def print_json(data):
    print(json.dumps(data, indent=2, ensure_ascii=False))


def print_error(msg):
    print(f"ERROR: {msg}", file=sys.stderr)


def print_ok(msg):
    print(f"OK: {msg}")


def print_info(msg):
    print(msg)


# ---------------------------------------------------------------------------
# AGENTS domain
# ---------------------------------------------------------------------------

def cmd_agents_list(config, args):
    agents_list = config.get("agents", {}).get("list", [])
    if not agents_list:
        print_info("No agents configured.")
        return
    for agent in agents_list:
        default_mark = " (default)" if agent.get("default") else ""
        model = agent.get("model", "")
        if isinstance(model, dict):
            model = model.get("primary", str(model))
        skills_count = len(agent.get("skills", []))
        print_info(f"  {agent['id']}{default_mark}  model={model}  skills={skills_count}  workspace={agent.get('workspace', '(default)')}")


def cmd_agents_show(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        available = [a["id"] for a in config.get("agents", {}).get("list", [])]
        if available:
            print_info(f"Available agents: {', '.join(available)}")
        return False
    print_json(agent)
    return True


def cmd_agents_add_skill(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        return False
    skills = agent.setdefault("skills", [])
    if args.skill_name in skills:
        print_ok(f"Skill '{args.skill_name}' already in agent '{args.agent_id}'.")
        return True
    skills.append(args.skill_name)
    print_ok(f"Added skill '{args.skill_name}' to agent '{args.agent_id}'.")
    return True


def cmd_agents_remove_skill(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        return False
    skills = agent.get("skills", [])
    if args.skill_name not in skills:
        print_error(f"Skill '{args.skill_name}' not found in agent '{args.agent_id}'.")
        return False
    skills.remove(args.skill_name)
    print_ok(f"Removed skill '{args.skill_name}' from agent '{args.agent_id}'.")
    return True


def cmd_agents_list_skills(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        return False
    skills = agent.get("skills", [])
    if not skills:
        print_info(f"Agent '{args.agent_id}' has no skills configured.")
    else:
        for s in skills:
            print_info(f"  - {s}")
    return True


def cmd_agents_add_tool(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        return False
    tools = agent.setdefault("tools", {})
    policy = "allow" if not args.deny else "deny"
    tool_list = tools.setdefault(policy, [])
    if args.tool_name in tool_list:
        print_ok(f"Tool '{args.tool_name}' already in {policy} list of agent '{args.agent_id}'.")
        return True
    tool_list.append(args.tool_name)
    print_ok(f"Added tool '{args.tool_name}' to {policy} list of agent '{args.agent_id}'.")
    return True


def cmd_agents_remove_tool(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        return False
    tools = agent.get("tools", {})
    policy = "allow" if not args.deny else "deny"
    tool_list = tools.get(policy, [])
    if args.tool_name not in tool_list:
        print_error(f"Tool '{args.tool_name}' not found in {policy} list of agent '{args.agent_id}'.")
        return False
    tool_list.remove(args.tool_name)
    print_ok(f"Removed tool '{args.tool_name}' from {policy} list of agent '{args.agent_id}'.")
    return True


def cmd_agents_list_tools(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        return False
    tools = agent.get("tools", {})
    allow = tools.get("allow", [])
    deny = tools.get("deny", [])
    print_info(f"Agent '{args.agent_id}' tools:")
    if allow:
        print_info("  allow:")
        for t in allow:
            print_info(f"    + {t}")
    if deny:
        print_info("  deny:")
        for t in deny:
            print_info(f"    - {t}")
    if not allow and not deny:
        print_info("  (no tool restrictions)")
    return True


def cmd_agents_allow_subagent(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        return False
    subagents = agent.setdefault("subagents", {})
    allow_list = subagents.setdefault("allowAgents", [])
    if args.subagent_id in allow_list:
        print_ok(f"Subagent '{args.subagent_id}' already allowed for agent '{args.agent_id}'.")
        return True
    allow_list.append(args.subagent_id)
    print_ok(f"Allowed subagent '{args.subagent_id}' for agent '{args.agent_id}'.")
    return True


def cmd_agents_remove_subagent(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        return False
    subagents = agent.get("subagents", {})
    allow_list = subagents.get("allowAgents", [])
    if args.subagent_id not in allow_list:
        print_error(f"Subagent '{args.subagent_id}' not in allowAgents of agent '{args.agent_id}'.")
        return False
    allow_list.remove(args.subagent_id)
    print_ok(f"Removed subagent '{args.subagent_id}' from agent '{args.agent_id}'.")
    return True


def cmd_agents_set_model(config, args):
    idx, agent = find_agent_index(config, args.agent_id)
    if agent is None:
        print_error(f"Agent '{args.agent_id}' not found.")
        return False
    agent["model"] = args.model
    print_ok(f"Set model for agent '{args.agent_id}' to '{args.model}'.")
    return True


def cmd_agents_add(config, args):
    agents_list = config.get("agents", {}).get("list", [])
    # Check duplicate
    for a in agents_list:
        if a.get("id") == args.agent_id:
            print_error(f"Agent '{args.agent_id}' already exists.")
            return False
    new_agent = {"id": args.agent_id}
    if args.workspace:
        new_agent["workspace"] = args.workspace
    if args.model:
        new_agent["model"] = args.model
    agents_list.append(new_agent)
    print_ok(f"Added agent '{args.agent_id}'.")
    return True


def cmd_agents_delete(config, args):
    agents_list = config.get("agents", {}).get("list", [])
    for i, a in enumerate(agents_list):
        if a.get("id") == args.agent_id:
            del agents_list[i]
            print_ok(f"Deleted agent '{args.agent_id}'.")
            return True
    print_error(f"Agent '{args.agent_id}' not found.")
    return False


def cmd_agents_check_duplicates(config, args):
    agents_list = config.get("agents", {}).get("list", [])
    ids = [a.get("id") for a in agents_list]
    seen = set()
    duplicates = []
    for aid in ids:
        if aid in seen:
            duplicates.append(aid)
        seen.add(aid)
    if duplicates:
        print_error(f"Duplicate agent IDs found: {', '.join(duplicates)}")
        for dup in set(duplicates):
            indices = [i for i, a in enumerate(agents_list) if a.get("id") == dup]
            print_info(f"  '{dup}' at indices: {indices}")
        return False
    print_ok("No duplicate agent IDs found.")
    return True


# ---------------------------------------------------------------------------
# SKILLS domain
# ---------------------------------------------------------------------------

def cmd_skills_list(config, args):
    entries = config.get("skills", {}).get("entries", {})
    if not entries:
        print_info("No skills entries configured.")
        return True
    for name, entry in entries.items():
        enabled = entry.get("enabled", "(unset)")
        extra_keys = [k for k in entry.keys() if k != "enabled"]
        extra = f"  extra: {', '.join(extra_keys)}" if extra_keys else ""
        print_info(f"  {name}: enabled={enabled}{extra}")
    return True


def cmd_skills_enable(config, args):
    entries = config.setdefault("skills", {}).setdefault("entries", {})
    entries.setdefault(args.skill_name, {})["enabled"] = True
    print_ok(f"Enabled skill '{args.skill_name}'.")
    return True


def cmd_skills_disable(config, args):
    entries = config.setdefault("skills", {}).setdefault("entries", {})
    entries.setdefault(args.skill_name, {})["enabled"] = False
    print_ok(f"Disabled skill '{args.skill_name}'.")
    return True


# ---------------------------------------------------------------------------
# BINDINGS domain
# ---------------------------------------------------------------------------

def cmd_bindings_list(config, args):
    bindings = config.get("bindings", [])
    if not bindings:
        print_info("No bindings configured.")
        return True
    for i, b in enumerate(bindings):
        agent_id = b.get("agentId", "?")
        match = b.get("match", {})
        channel = match.get("channel", "?")
        account = match.get("accountId", "(default)")
        peer = match.get("peer", {})
        peer_str = f" peer={peer}" if peer else ""
        print_info(f"  [{i}] {agent_id} <- {channel}:{account}{peer_str}")
    return True


def cmd_bindings_add(config, args):
    bindings = config.setdefault("bindings", [])
    match = {"channel": args.channel}
    if args.account:
        match["accountId"] = args.account
    new_binding = {"agentId": args.agent, "match": match}
    # Check if same binding already exists
    for b in bindings:
        if b.get("agentId") == args.agent and b.get("match", {}).get("channel") == args.channel:
            existing_account = b.get("match", {}).get("accountId")
            if existing_account == (args.account or None):
                print_ok(f"Binding already exists: {args.agent} <- {args.channel}:{args.account or '(default)'}")
                return True
    bindings.append(new_binding)
    print_ok(f"Added binding: {args.agent} <- {args.channel}:{args.account or '(default)'}")
    return True


def cmd_bindings_remove(config, args):
    bindings = config.get("bindings", [])
    new_bindings = []
    removed = False
    for b in bindings:
        match = b.get("match", {})
        if (b.get("agentId") == args.agent and
            match.get("channel") == args.channel and
            match.get("accountId") == (args.account or None)):
            removed = True
            continue
        new_bindings.append(b)
    if not removed:
        print_error(f"Binding not found: {args.agent} <- {args.channel}:{args.account or '(default)'}")
        return False
    config["bindings"] = new_bindings
    print_ok(f"Removed binding: {args.agent} <- {args.channel}:{args.account or '(default)'}")
    return True


# ---------------------------------------------------------------------------
# CHANNELS domain
# ---------------------------------------------------------------------------

def cmd_channels_list_accounts(config, args):
    channels = config.get("channels", {})
    target = args.channel if args.channel else None
    if target:
        ch = channels.get(target, {})
        accounts = ch.get("accounts", {})
        if not accounts:
            print_info(f"No accounts configured for channel '{target}'.")
        else:
            for name, acc in accounts.items():
                enabled = acc.get("enabled", "(unset)")
                print_info(f"  {target}/{name}: enabled={enabled}")
    else:
        for ch_name, ch_conf in channels.items():
            if not isinstance(ch_conf, dict):
                continue
            accounts = ch_conf.get("accounts", {})
            if accounts:
                for name in accounts:
                    print_info(f"  {ch_name}/{name}")
    return True


def cmd_channels_add_account(config, args):
    channels = config.setdefault("channels", {})
    ch = channels.setdefault(args.channel, {})
    accounts = ch.setdefault("accounts", {})
    if args.account_id in accounts:
        print_error(f"Account '{args.account_id}' already exists in channel '{args.channel}'.")
        return False
    new_account = {"enabled": True}
    if args.app_id:
        new_account["appId"] = args.app_id
    if args.app_secret:
        new_account["appSecret"] = args.app_secret
    accounts[args.account_id] = new_account
    print_ok(f"Added account '{args.account_id}' to channel '{args.channel}'.")
    return True


def cmd_channels_remove_account(config, args):
    channels = config.get("channels", {})
    ch = channels.get(args.channel, {})
    accounts = ch.get("accounts", {})
    if args.account_id not in accounts:
        print_error(f"Account '{args.account_id}' not found in channel '{args.channel}'.")
        return False
    del accounts[args.account_id]
    print_ok(f"Removed account '{args.account_id}' from channel '{args.channel}'.")
    return True


def cmd_channels_set_system_prompt(config, args):
    channels = config.get("channels", {})
    ch = channels.get(args.channel, {})
    accounts = ch.get("accounts", {})
    if args.account_id not in accounts:
        print_error(f"Account '{args.account_id}' not found in channel '{args.channel}'.")
        return False
    accounts[args.account_id]["systemPrompt"] = args.prompt
    print_ok(f"Set systemPrompt for '{args.channel}/{args.account_id}'.")
    return True


# ---------------------------------------------------------------------------
# MCP domain
# ---------------------------------------------------------------------------

def cmd_mcp_list(config, args):
    servers = config.get("mcp", {}).get("servers", {})
    if not servers:
        print_info("No MCP servers configured.")
        return True
    for name, conf in servers.items():
        cmd = conf.get("command", "?")
        server_args = conf.get("args", [])
        print_info(f"  {name}: {cmd} {' '.join(server_args)}")
    return True


def cmd_mcp_add(config, args):
    mcp = config.setdefault("mcp", {})
    servers = mcp.setdefault("servers", {})
    new_server = {"command": args.command}
    if args.args:
        new_server["args"] = args.args.split()
    if args.env:
        env = {}
        for pair in args.env:
            if "=" in pair:
                k, v = pair.split("=", 1)
                env[k] = v
        if env:
            new_server["env"] = env
    if args.timeout:
        new_server["connectionTimeoutMs"] = args.timeout
    servers[args.name] = new_server
    print_ok(f"Added MCP server '{args.name}'.")
    return True


def cmd_mcp_remove(config, args):
    servers = config.get("mcp", {}).get("servers", {})
    if args.name not in servers:
        print_error(f"MCP server '{args.name}' not found.")
        return False
    del servers[args.name]
    print_ok(f"Removed MCP server '{args.name}'.")
    return True


# ---------------------------------------------------------------------------
# SHOW domain
# ---------------------------------------------------------------------------

def cmd_show_overview(config, args):
    agents_list = config.get("agents", {}).get("list", [])
    bindings = config.get("bindings", [])
    channels = config.get("channels", {})
    skills_entries = config.get("skills", {}).get("entries", {})
    mcp_servers = config.get("mcp", {}).get("servers", {})

    print_info("=== OpenClaw Configuration Overview ===")
    print_info(f"Agents: {len(agents_list)}")
    print_info(f"Bindings: {len(bindings)}")
    active_channels = [k for k, v in channels.items() if isinstance(v, dict) and v.get("enabled", False)]
    print_info(f"Active channels: {', '.join(active_channels) if active_channels else 'none'}")
    enabled_skills = [k for k, v in skills_entries.items() if v.get("enabled")]
    print_info(f"Enabled skills: {len(enabled_skills)}/{len(skills_entries)}")
    print_info(f"MCP servers: {len(mcp_servers)}")
    return True


def cmd_show_agents(config, args):
    cmd_agents_list(config, args)
    return True


def cmd_show_bindings(config, args):
    cmd_bindings_list(config, args)
    return True


# ---------------------------------------------------------------------------
# UTILITY domain
# ---------------------------------------------------------------------------

def cmd_validate(config, args):
    # Basic structural validation
    errors = []
    agents_list = config.get("agents", {}).get("list", [])
    # Check duplicate IDs
    ids = [a.get("id") for a in agents_list]
    seen = set()
    for aid in ids:
        if aid in seen:
            errors.append(f"Duplicate agent ID: {aid}")
        seen.add(aid)
    # Check missing IDs
    for i, a in enumerate(agents_list):
        if not a.get("id"):
            errors.append(f"Agent at index {i} has no 'id' field")
    # Check bindings reference valid agents
    for b in config.get("bindings", []):
        aid = b.get("agentId")
        if aid and aid not in ids:
            errors.append(f"Binding references unknown agent '{aid}'")

    if errors:
        for e in errors:
            print_error(e)
        return False
    print_ok("Configuration validation passed.")
    return True


def cmd_backup(config, args):
    path = resolve_config_path()
    backup_path = backup_config(path, "manual")
    print_ok(f"Backup created: {backup_path}")
    return True


# ---------------------------------------------------------------------------
# Main CLI
# ---------------------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(
        description="openclaw-config: Safe configuration editor for openclaw.json",
        prog="openclaw-config"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    subparsers = parser.add_subparsers(dest="domain", required=True)

    # --- agents ---
    agents_p = subparsers.add_parser("agents", help="Agent management")
    agents_sub = agents_p.add_subparsers(dest="action", required=True)

    # agents list
    p = agents_sub.add_parser("list", help="List all agents")
    p.set_defaults(func=cmd_agents_list)

    # agents show
    p = agents_sub.add_parser("show", help="Show agent details")
    p.add_argument("agent_id")
    p.set_defaults(func=cmd_agents_show)

    # agents add-skill
    p = agents_sub.add_parser("add-skill", help="Add skill to agent")
    p.add_argument("agent_id")
    p.add_argument("skill_name")
    p.set_defaults(func=cmd_agents_add_skill)

    # agents remove-skill
    p = agents_sub.add_parser("remove-skill", help="Remove skill from agent")
    p.add_argument("agent_id")
    p.add_argument("skill_name")
    p.set_defaults(func=cmd_agents_remove_skill)

    # agents list-skills
    p = agents_sub.add_parser("list-skills", help="List agent skills")
    p.add_argument("agent_id")
    p.set_defaults(func=cmd_agents_list_skills)

    # agents add-tool
    p = agents_sub.add_parser("add-tool", help="Add tool to agent (allow by default)")
    p.add_argument("agent_id")
    p.add_argument("tool_name")
    p.add_argument("--deny", action="store_true", help="Add to deny list instead")
    p.set_defaults(func=cmd_agents_add_tool)

    # agents remove-tool
    p = agents_sub.add_parser("remove-tool", help="Remove tool from agent")
    p.add_argument("agent_id")
    p.add_argument("tool_name")
    p.add_argument("--deny", action="store_true", help="Remove from deny list")
    p.set_defaults(func=cmd_agents_remove_tool)

    # agents list-tools
    p = agents_sub.add_parser("list-tools", help="List agent tools")
    p.add_argument("agent_id")
    p.set_defaults(func=cmd_agents_list_tools)

    # agents allow-subagent
    p = agents_sub.add_parser("allow-subagent", help="Allow subagent for agent")
    p.add_argument("agent_id")
    p.add_argument("subagent_id")
    p.set_defaults(func=cmd_agents_allow_subagent)

    # agents remove-subagent
    p = agents_sub.add_parser("remove-subagent", help="Remove subagent from agent")
    p.add_argument("agent_id")
    p.add_argument("subagent_id")
    p.set_defaults(func=cmd_agents_remove_subagent)

    # agents set-model
    p = agents_sub.add_parser("set-model", help="Set agent model")
    p.add_argument("agent_id")
    p.add_argument("model")
    p.set_defaults(func=cmd_agents_set_model)

    # agents add
    p = agents_sub.add_parser("add", help="Add new agent")
    p.add_argument("agent_id")
    p.add_argument("--workspace", help="Workspace path")
    p.add_argument("--model", help="Default model")
    p.set_defaults(func=cmd_agents_add)

    # agents delete
    p = agents_sub.add_parser("delete", help="Delete agent")
    p.add_argument("agent_id")
    p.set_defaults(func=cmd_agents_delete)

    # agents check-duplicates
    p = agents_sub.add_parser("check-duplicates", help="Check for duplicate agent IDs")
    p.set_defaults(func=cmd_agents_check_duplicates)

    # --- skills ---
    skills_p = subparsers.add_parser("skills", help="Skill management")
    skills_sub = skills_p.add_subparsers(dest="action", required=True)

    p = skills_sub.add_parser("list", help="List all skills")
    p.set_defaults(func=cmd_skills_list)

    p = skills_sub.add_parser("enable", help="Enable a skill")
    p.add_argument("skill_name")
    p.set_defaults(func=cmd_skills_enable)

    p = skills_sub.add_parser("disable", help="Disable a skill")
    p.add_argument("skill_name")
    p.set_defaults(func=cmd_skills_disable)

    # --- bindings ---
    bindings_p = subparsers.add_parser("bindings", help="Binding management")
    bindings_sub = bindings_p.add_subparsers(dest="action", required=True)

    p = bindings_sub.add_parser("list", help="List all bindings")
    p.set_defaults(func=cmd_bindings_list)

    p = bindings_sub.add_parser("add", help="Add binding")
    p.add_argument("--agent", required=True, help="Agent ID")
    p.add_argument("--channel", required=True, help="Channel name")
    p.add_argument("--account", help="Account ID")
    p.set_defaults(func=cmd_bindings_add)

    p = bindings_sub.add_parser("remove", help="Remove binding")
    p.add_argument("--agent", required=True, help="Agent ID")
    p.add_argument("--channel", required=True, help="Channel name")
    p.add_argument("--account", help="Account ID")
    p.set_defaults(func=cmd_bindings_remove)

    # --- channels ---
    channels_p = subparsers.add_parser("channels", help="Channel account management")
    channels_sub = channels_p.add_subparsers(dest="action", required=True)

    p = channels_sub.add_parser("list-accounts", help="List channel accounts")
    p.add_argument("channel", nargs="?", help="Channel name (omit for all)")
    p.set_defaults(func=cmd_channels_list_accounts)

    p = channels_sub.add_parser("add-account", help="Add channel account")
    p.add_argument("channel")
    p.add_argument("account_id")
    p.add_argument("--app-id", help="App ID")
    p.add_argument("--app-secret", help="App Secret")
    p.set_defaults(func=cmd_channels_add_account)

    p = channels_sub.add_parser("remove-account", help="Remove channel account")
    p.add_argument("channel")
    p.add_argument("account_id")
    p.set_defaults(func=cmd_channels_remove_account)

    p = channels_sub.add_parser("set-system-prompt", help="Set account system prompt")
    p.add_argument("channel")
    p.add_argument("account_id")
    p.add_argument("prompt")
    p.set_defaults(func=cmd_channels_set_system_prompt)

    # --- mcp ---
    mcp_p = subparsers.add_parser("mcp", help="MCP server management")
    mcp_sub = mcp_p.add_subparsers(dest="action", required=True)

    p = mcp_sub.add_parser("list", help="List MCP servers")
    p.set_defaults(func=cmd_mcp_list)

    p = mcp_sub.add_parser("add", help="Add MCP server")
    p.add_argument("name")
    p.add_argument("--command", required=True)
    p.add_argument("--args", help="Arguments (space-separated)")
    p.add_argument("--env", nargs="*", help="Env vars (KEY=VALUE)")
    p.add_argument("--timeout", type=int, help="Connection timeout in ms")
    p.set_defaults(func=cmd_mcp_add)

    p = mcp_sub.add_parser("remove", help="Remove MCP server")
    p.add_argument("name")
    p.set_defaults(func=cmd_mcp_remove)

    # --- show ---
    show_p = subparsers.add_parser("show", help="Show config info")
    show_sub = show_p.add_subparsers(dest="action", required=True)

    p = show_sub.add_parser("overview", help="Config overview")
    p.set_defaults(func=cmd_show_overview)

    p = show_sub.add_parser("agents", help="Show agents")
    p.set_defaults(func=cmd_show_agents)

    p = show_sub.add_parser("bindings", help="Show bindings")
    p.set_defaults(func=cmd_show_bindings)

    # --- validate ---
    p = subparsers.add_parser("validate", help="Validate configuration")
    p.set_defaults(func=cmd_validate)

    # --- backup ---
    p = subparsers.add_parser("backup", help="Backup configuration")
    p.set_defaults(func=cmd_backup)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    config_path = resolve_config_path()
    if not os.path.exists(config_path):
        print_error(f"Config file not found: {config_path}")
        sys.exit(1)

    # Load
    config = load_config(config_path)

    # Execute read-only command
    func = args.func
    domain = args.domain
    action = getattr(args, "action", None)

    read_only_domains = {"show", "validate", "backup"}
    read_only_actions = {"list", "show", "list-skills", "list-tools", "check-duplicates",
                         "list-accounts", "overview", "agents", "bindings"}

    is_read_only = domain in read_only_domains or action in read_only_actions

    # For backup, execute directly (it handles its own I/O)
    if domain == "backup":
        func(config, args)
        return

    if is_read_only:
        result = func(config, args)
        sys.exit(0 if result is not False else 1)

    # Write operation
    # Backup first
    action_desc = f"{domain}-{action}" if action else domain
    backup_path = backup_config(config_path, action_desc)

    # Execute modification
    result = func(config, args)
    if result is False:
        # Remove backup since nothing changed
        os.remove(backup_path)
        sys.exit(1)

    if args.dry_run:
        print_info(f"\n[DRY RUN] Changes would be written to: {config_path}")
        print_info(f"[DRY RUN] Backup would be at: {backup_path}")
        os.remove(backup_path)
        sys.exit(0)

    # Save
    save_config(config, config_path)
    print_info(f"Config saved. Backup: {backup_path}")


if __name__ == "__main__":
    main()
