"""FirstTouch MCP server.

Exposes the What-If decision-intelligence engine as real Model Context Protocol
tools. This is a genuine MCP server (FastMCP, streamable-HTTP): IBM Context Forge
federates it, and the LangChain chain in whatif_chain.py calls these tools
THROUGH the gateway. The tool body is the real xT option engine (whatif.py), so
nothing here is mocked.

Run:  python mcp_server.py   (defaults to 127.0.0.1:9000/mcp)
"""

import os

from mcp.server.fastmcp import FastMCP

import whatif

HOST = os.getenv("FT_MCP_HOST", "127.0.0.1")
PORT = int(os.getenv("FT_MCP_PORT", "9000"))

mcp = FastMCP("firsttouch", host=HOST, port=PORT)


@mcp.tool()
def score_options(frame: dict) -> dict:
    """Value every option a player had at one on-ball moment.

    Args:
        frame: a FirstTouch freeze-frame dict (players[], event{}, context{}).
    Returns:
        {origin, actor, options[], summary{}} where each option carries its
        real xT-added (or estimated xG for a shot), viability, and chosen/best
        flags. Powered by the Karun Singh xT surface.
    """
    return whatif.enumerate_options(frame)


@mcp.tool()
def xt_value(x: float, y: float) -> float:
    """Expected Threat (xT) at a StatsBomb pitch location (120x80, attack +x)."""
    return whatif.xt_at([x, y])


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
