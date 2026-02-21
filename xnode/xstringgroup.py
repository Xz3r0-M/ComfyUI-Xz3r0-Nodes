class XStringGroup:
    separation_method_options = [
        "none",
        "newline",
        "space",
        "comma",
        "comma_space",
        "period",
        "period_space",
    ]
    select_string_options = ["1", "2", "3", "4", "5"]

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "select_string": (
                    s.select_string_options,
                    {
                        "default": "1",
                        "tooltip": "Select which string to output (1-5)",
                    },
                ),
                "string_1": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "First multiline string input",
                    },
                ),
                "separation_method_1_2": (
                    s.separation_method_options,
                    {
                        "default": "none",
                        "tooltip": "Separation method between String 1 and "
                        "String 2 (none: '', newline: \\n, space: ' ', "
                        "comma: ',', comma_space: ', ', period: '.', "
                        "period_space: '. ')",
                    },
                ),
                "string_2": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "Second multiline string input",
                    },
                ),
                "separation_method_2_3": (
                    s.separation_method_options,
                    {
                        "default": "none",
                        "tooltip": "Separation method between String 2 and "
                        "String 3 (none: '', newline: \\n, space: ' ', "
                        "comma: ',', comma_space: ', ', period: '.', "
                        "period_space: '. ')",
                    },
                ),
                "string_3": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "Third multiline string input",
                    },
                ),
                "separation_method_3_4": (
                    s.separation_method_options,
                    {
                        "default": "none",
                        "tooltip": "Separation method between String 3 and "
                        "String 4 (none: '', newline: \\n, space: ' ', "
                        "comma: ',', comma_space: ', ', period: '.', "
                        "period_space: '. ')",
                    },
                ),
                "string_4": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "Fourth multiline string input",
                    },
                ),
                "separation_method_4_5": (
                    s.separation_method_options,
                    {
                        "default": "none",
                        "tooltip": "Separation method between String 4 and "
                        "String 5 (none: '', newline: \\n, space: ' ', "
                        "comma: ',', comma_space: ', ', period: '.', "
                        "period_space: '. ')",
                    },
                ),
                "string_5": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "Fifth multiline string input",
                    },
                ),
            }
        }

    RETURN_TYPES = (
        "STRING",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
    )
    RETURN_NAMES = (
        "total_string",
        "selected_string",
        "string_1",
        "string_2",
        "string_3",
        "string_4",
        "string_5",
    )
    OUTPUT_TOOLTIPS = (
        "Output of all grouped strings (with separation methods)",
        "Selected string output based on select_string",
        "Original output of String 1",
        "Original output of String 2",
        "Original output of String 3",
        "Original output of String 4",
        "Original output of String 5",
    )
    FUNCTION = "group_strings"

    CATEGORY = "♾️ Xz3r0/Workflow-Processing"

    def group_strings(
        self,
        select_string,
        string_1,
        string_2,
        string_3,
        string_4,
        string_5,
        separation_method_1_2,
        separation_method_2_3,
        separation_method_3_4,
        separation_method_4_5,
    ):
        separation_method_map = {
            "none": "",
            "newline": "\n",
            "space": " ",
            "comma": ",",
            "comma_space": ", ",
            "period": ".",
            "period_space": ". ",
        }

        sm_1_2 = separation_method_map[separation_method_1_2]
        sm_2_3 = separation_method_map[separation_method_2_3]
        sm_3_4 = separation_method_map[separation_method_3_4]
        sm_4_5 = separation_method_map[separation_method_4_5]

        grouped_string = (
            string_1
            + sm_1_2
            + string_2
            + sm_2_3
            + string_3
            + sm_3_4
            + string_4
            + sm_4_5
            + string_5
        )

        strings = [string_1, string_2, string_3, string_4, string_5]
        selected_string = strings[int(select_string) - 1]

        return (
            grouped_string,
            selected_string,
            string_1,
            string_2,
            string_3,
            string_4,
            string_5,
        )


NODE_CLASS_MAPPINGS = {
    "XStringGroup": XStringGroup,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "XStringGroup": "XStringGroup",
}
