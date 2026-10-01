# >>> dotclaude system prompt >>>
# Managed by /dotclaude:apply-settings-profile. Edits inside this block are replaced.
function claude --description 'Claude Code with the dotclaude system prompt'
    set -l f '/home/user/.claude/dotclaude/system-prompt.md'
    test -n "$DOTCLAUDE_SYSTEM_PROMPT_FILE"; and set f $DOTCLAUDE_SYSTEM_PROMPT_FILE
    if test "$DOTCLAUDE_SYSTEM_PROMPT" = 0; or not test -r "$f"
        DOTCLAUDE_LAUNCHER=1 command claude $argv
        return
    end
    for a in $argv
        switch $a
            case --system-prompt '--system-prompt=*' --system-prompt-file '--system-prompt-file=*'
                DOTCLAUDE_LAUNCHER=1 command claude $argv
                return
        end
    end
    DOTCLAUDE_LAUNCHER=1 command claude --system-prompt-file "$f" $argv
end
# <<< dotclaude system prompt <<<
