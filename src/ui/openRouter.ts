export type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
};

export type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

export type OpenRouterResponse = {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: OpenRouterToolCall[];
    };
  }[];
  usage?: OpenRouterUsage;
};

export const characterTools = [
  {
    type: "function",
    function: {
      name: "find_characters",
      description: "Find character IDs by canonical character name within the active project before requesting a character division.",
      parameters: {
        type: "object",
        properties: {
          nameQuery: { type: "string", description: "Canonical name or partial name of the character to find." }
        },
        required: ["nameQuery"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_character_identity",
      description: "Return only the requested character identity division for a stable character ID.",
      parameters: {
        type: "object",
        properties: {
          characterId: { type: "string", description: "Stable character ID returned by find_characters." }
        },
        required: ["characterId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_character_bio",
      description: "Return only the requested character bio division for a stable character ID.",
      parameters: {
        type: "object",
        properties: {
          characterId: { type: "string", description: "Stable character ID returned by find_characters." }
        },
        required: ["characterId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_character_stats",
      description: "Return only the requested character stats division for a stable character ID.",
      parameters: {
        type: "object",
        properties: {
          characterId: { type: "string", description: "Stable character ID returned by find_characters." }
        },
        required: ["characterId"]
      }
    }
  }
] as const;

export const inventoryTools = [
  {
    type: "function",
    function: {
      name: "update_inventory_item",
      description: "Add or subtract a quantity from the current chat inventory. Use a positive delta for gained items and a negative delta for spent/lost/removed items. Subtract only the amount used/lost; do not remove a whole stack unless the full quantity is gone. Item names should be singular stack names where possible. Every newly added physical inventory item must have a reasonable estimated per-unit weight.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["inventory", "currency"], description: "Use inventory for carried items/ammo/consumables and currency for the chat currency amount." },
          name: { type: "string", description: "Singular item stack name, or the currency name when kind is currency." },
          delta: { type: "number", description: "Quantity change. Example: -12 when 12 rounds are used, 32 when 32 rounds are picked up." },
          unitWeightKg: { type: "number", minimum: 0.01, description: "Estimated weight in KG for one unit. Required when adding a physical inventory item that does not already have a stored weight. Make a reasonable estimate rather than omitting it. Do not provide weight for currency. Use at least 0.01kg and no long decimals." },
          logSentence: { type: "string", description: "One terse narrative sentence explaining this exact inventory change and where it came from or went, such as 'Obtained Admin Key x 1 from Jaeger.' or 'Spent 9mm x 12 during the alley fight.'" }
        },
        required: ["kind", "name", "delta", "logSentence"]
      }
    }
  }
] as const;

export const imageContextTools = [
  {
    type: "function",
    function: {
      name: "save_image_context",
      description: "Store a hidden, detailed visual extraction for the image attached to the current user message. Call this exactly once before replying normally. Use dense factual structured lines, not prose: medium/style, subjects and appearance, setting, actions, objects, composition, colours/lighting, visible text, notable details, and uncertainties. Do not include commentary, advice, or claims beyond the image.",
      parameters: {
        type: "object",
        properties: {
          context: { type: "string", description: "Detailed concise visual extraction in structured lines." }
        },
        required: ["context"]
      }
    }
  }
] as const;

export const memoryTools = [
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save or propose one durable memory using the project's memory instruction. Do not save transient scene actions, minor details, duplicates, or speculation.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "One durable memory fact that will remain useful later." },
          tags: { type: "array", items: { type: "string" }, description: "Relevant names, places, topics, or continuity tags." },
          reason: { type: "string", description: "Brief reason this is worth remembering." },
          confidence: { type: "number", description: "Confidence from 0 to 1." }
        },
        required: ["text", "tags", "reason", "confidence"]
      }
    }
  }
] as const;

export const deltaImminentTools = [
  {
    type: "function",
    function: {
      name: "prepare_delta_engagement",
      description: "Create a pending Delta Mode imminent card when the main chat reaches a confrontation, mission commitment, fight, hostile standoff, or structured engagement. Do not use this for ordinary tension or casual disagreement.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "One to three compact third-person sentences continuing the roleplay at the exact immediate place and moment. State what is physically happening and what forces the engagement. Prefer concrete information over atmospheric description. Do not write a cast list, mission synopsis, movie-trailer language, or assistant-facing explanation." },
          handoffContext: { type: "string", description: "Compact exact non-roster continuity anchors for Delta startup. Use separate terse lines beginning with Location:, Objective:, Situation:, or Constraint:. Preserve exact names, item codes, and facts. Participant membership belongs only in team, neutral, and enemies." },
          team: { type: "array", items: { type: "string" }, description: "Every allied participant physically involved, including the likely player character when appropriate. Use a canonical name or a concrete observable identity such as Armed woman or Grey wolf. Never use unknown, mysterious, unidentified, figure, shape, presence, or creature as an abstract identity." },
          neutral: { type: "array", items: { type: "string" }, description: "Concrete neutral participants physically involved. Use an empty list when there are none." },
          enemies: { type: "array", items: { type: "string" }, description: "Every opposing participant physically involved. Use canonical names where known; otherwise use concrete visible identities such as Scarred enforcer, Woman with shotgun, or Grey wolf. Distinguish multiples concretely. Never use unknown, mysterious, unidentified, figure, shape, presence, or creature as an abstract identity." },
          playerCharacterName: { type: "string", description: "Likely player-controlled character name, if known." },
          mapSize: { type: "string", enum: ["S", "M", "L", "XL", "XXL"], description: "Choose the engagement map boundary from the immediate scene: S = 30m, M = 50m, L = 80m, XL = 100m, XXL = 200m. This is the actual scene boundary, not a zoom level. Choose the smallest size that fairly contains the engagement and likely movement." },
          avoidLabel: { type: "string", description: "Button label for avoiding the engagement, usually Escape for danger or Cancel for a proposed mission." },
          avoidPrompt: { type: "string", description: "Short UI question asking what the player does to avoid or cancel the engagement." }
        },
        required: ["brief", "team", "neutral", "enemies", "mapSize"]
      }
    }
  }
] as const;

export const deltaEntityTools = [
  {
    type: "function",
    function: {
      name: "set_delta_engagement_name",
      description: "Set the concise, in-world name for this active engagement. Use it once when an engagement begins, based on the location, activity, or case. Never call it Delta Mode, New Engagement, or Untitled Engagement.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "A concise in-world engagement title." }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_delta_map",
      description: "Stage the active engagement's terrain map once, using only non-open tiles. Coordinates are one-based row/column positions within the fixed map boundary. Do not use this to place entities.",
      parameters: {
        type: "object",
        properties: {
          tiles: {
            type: "array",
            description: "Only terrain/access tiles that differ from open ground.",
            items: {
              type: "object",
              properties: {
                row: { type: "number", description: "One-based grid row." },
                column: { type: "number", description: "One-based grid column." },
                kind: { type: "string", enum: ["solid", "half", "special", "access"] },
                label: { type: "string", description: "Concrete terrain/object label, such as warehouse shelf, flooded channel, or security door." },
                color: { type: "string", description: "For special terrain only: a readable hex color chosen to suit the hazard, such as #3f83c5 for water or #5e9d68 for gas." },
                accessState: { type: "string", enum: ["open", "closed", "locked"], description: "For access only." }
              },
              required: ["row", "column", "kind"]
            }
          }
        },
        required: ["tiles"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_delta_job_categories",
      description: "List available Delta JOB categories for generated entities. Use this before selecting a JOB when categories exist.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_delta_jobs_for_category",
      description: "Return the JOB templates for one readable category. Pick a JOB label from this list when it fits the narrative.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Readable JOB category name." }
        },
        required: ["category"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_delta_entity",
      description: "Create one current Delta entity only for a person, creature, or active participant. Never create entities from position/range/cover/status phrases; put those details in statusText, distanceFromPlayer, elevation, or map coordinates instead. Use saved characterId for known saved characters; otherwise apply readable PREFIX, BASE, and optional JOB labels from the project templates so generated stats are created. Do not invent hidden template IDs.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          side: { type: "string", enum: ["ally", "neutral", "hostile"] },
          characterId: { type: "string", description: "Optional saved character ID returned by find_characters." },
          prefix: { type: "string", description: "Optional readable PREFIX label, such as DEX." },
          base: { type: "string", description: "Optional readable BASE label, such as LIGHT." },
          job: { type: "string", description: "Optional readable JOB label, such as ROGUE." },
          jobCategory: { type: "string", description: "Optional readable JOB category used only to look up modifiers." },
          statusText: { type: "string" },
          distanceFromPlayer: { type: "string" },
          elevation: { type: "string" },
          mapRow: { type: "number", description: "One-based map row for this entity's current position." },
          mapColumn: { type: "number", description: "One-based map column for this entity's current position." }
        },
        required: ["name", "side"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "finish_delta_engagement",
      description: "Finish the current Delta engagement when its narrative outcome is resolved. This opens the proper finish, loot, archive, and parent-chat handoff flow. Do not write an assistant-style closing message instead.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "set_delta_player_entity",
      description: "Mark the current player-controlled entity for turn ownership. Use this after creating or linking the player character named by the Delta Brief.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Entity ID returned by create_delta_entity or already present in the current entity list." }
        },
        required: ["entityId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "request_delta_roll",
      description: "Request authoritative client-generated dice results with the rolling entity's real stat modifier. For player rolls, Delta Mode waits for the user to click the required die. For NPC/ally/hostile/non-player rolls, the client rolls immediately, displays its own verified roll row, and returns the modified total. Never write or repeat a dice-result line in prose.",
      parameters: {
        type: "object",
        properties: {
          die: { type: "number", description: "Required die sides. Use 4, 6, 8, 9, 12, 20, or 100." },
          count: { type: "number", description: "How many of this die must be rolled. Defaults to 1." },
          label: { type: "string", description: "Short roleplay-facing roll label, such as initiative, lockpick, damage, or resist fear." },
          rollerName: { type: "string", description: "Name of the entity rolling, especially for NPC/ally/hostile rolls." },
          ability: { type: "string", enum: ["STR", "DEX", "CON", "INT", "WIS", "CHA", "NONE"], description: "Governing stat whose modifier the client must apply. Use NONE only when this roll genuinely has no stat modifier." }
        },
        required: ["die", "label", "ability"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "request_delta_reaction",
      description: "Check whether an active target can react to an incoming threat outside their turn. Call this after the initiating attack/check roll is known but before resolving damage or the final consequence. The client performs an authoritative 1d8 + DEX check against 6 and enforces one reaction attempt per entity per round. A successful player reaction pauses the current turn for the player's response.",
      parameters: {
        type: "object",
        properties: {
          targetEntityId: { type: "string", description: "Entity ID of the active entity threatened by the current action." },
          trigger: { type: "string", description: "One concise in-world description of the immediate threat being reacted to." }
        },
        required: ["targetEntityId", "trigger"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "request_delta_action",
      description: "Pause Delta Mode for the player's response using a short floating prompt. The prompt is UI state only and is not added to the transcript. Use this instead of writing 'what do you do' into the Delta log.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Short in-world prompt asking for the player's action." }
        },
        required: ["prompt"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "continue_delta_player_turn",
      description: "Post the addressed entity's brief cinematic reply and keep the current player's numbered turn open after a dialogue-only or communication-only entry. Use this only when the player spoke, signalled, or communicated without attempting movement, an attack, an interaction, an item use, a roll-worthy influence attempt, or another turn-consuming action. This is not a new turn.",
      parameters: {
        type: "object",
        properties: {
          cinematicReply: { type: "string", description: "Required concise in-world reply or immediate nonverbal response from the entity the player addressed. Do not include the cinematic marker." },
          prompt: { type: "string", description: "Optional short prompt indicating that the player's turn remains open." }
        },
        required: ["cinematicReply"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "apply_delta_damage",
      description: "Apply damage through the client after request_delta_roll returns a verified damage roll. The client subtracts the amount atomically, clamps HP at zero, and prevents the same roll receipt from damaging the same entity twice. Never calculate or overwrite currentHp yourself.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Target entity ID from the current entity list." },
          amount: { type: "number", description: "Final positive whole-number damage amount to subtract." },
          rollReceiptId: { type: "string", description: "Receipt ID returned by the authoritative request_delta_roll result used for this damage." },
          zeroHpOutcome: { type: "string", enum: ["ko", "dead"], description: "State to apply if this damage reduces the target to 0 HP. Choose KO when the target remains alive but unable to act, or DEAD when the fiction establishes death." }
        },
        required: ["entityId", "amount", "rollReceiptId", "zeroHpOutcome"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_delta_entity",
      description: "Update an existing current Delta entity by entityId. Template values are readable labels only.",
      parameters: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          name: { type: "string" },
          side: { type: "string", enum: ["ally", "neutral", "hostile"] },
          engagementState: { type: "string", enum: ["active", "ko", "dead", "escaped"], description: "Whether this entity can still take turns. Use escaped immediately when an entity leaves the engagement." },
          prefix: { type: "string" },
          base: { type: "string" },
          job: { type: "string" },
          jobCategory: { type: "string" },
          statusText: { type: "string" },
          maxHp: { type: "number", description: "Maximum HP only when it must be corrected." },
          initiative: { type: "number", description: "Initiative result used to order the entity list." },
          distanceFromPlayer: { type: "string" },
          elevation: { type: "string" },
          mapRow: { type: "number", description: "One-based map row for this entity's current position." },
          mapColumn: { type: "number", description: "One-based map column for this entity's current position." }
        },
        required: ["entityId"]
      }
    }
  }
] as const;
