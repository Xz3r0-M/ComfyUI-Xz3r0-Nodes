class XStringGroup:
    separation_method_options = ["newline", "space", "comma", "period"]
    select_string_options = ["1", "2", "3", "4", "5"]

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "select_string": (s.select_string_options, {"default": "1", "tooltip": "Select which string to output (1-5)"}),
                "string_1": ("STRING", {"multiline": True, "default": "", "tooltip": "First string input"}),
                "separation_method_1_2": (s.separation_method_options, {"default": "newline", "tooltip": "Separation method between string_1 and string_2"}),
                "string_2": ("STRING", {"multiline": True, "default": "", "tooltip": "Second string input"}),
                "separation_method_2_3": (s.separation_method_options, {"default": "newline", "tooltip": "Separation method between string_2 and string_3"}),
                "string_3": ("STRING", {"multiline": True, "default": "", "tooltip": "Third string input"}),
                "separation_method_3_4": (s.separation_method_options, {"default": "newline", "tooltip": "Separation method between string_3 and string_4"}),
                "string_4": ("STRING", {"multiline": True, "default": "", "tooltip": "Fourth string input"}),
                "separation_method_4_5": (s.separation_method_options, {"default": "newline", "tooltip": "Separation method between string_4 and string_5"}),
                "string_5": ("STRING", {"multiline": True, "default": "", "tooltip": "Fifth string input"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("total_string", "selected_string", "string_1", "string_2", "string_3", "string_4", "string_5")
    OUTPUT_TOOLTIPS = ("Grouped string with specified separation methods", "Selected string output based on select_string parameter", "String 1 output", "String 2 output", "String 3 output", "String 4 output", "String 5 output")
    FUNCTION = "group_strings"

    CATEGORY = "♾️ Xz3r0/Types"

    def group_strings(self, select_string, string_1, string_2, string_3, string_4, string_5, separation_method_1_2, separation_method_2_3, separation_method_3_4, separation_method_4_5):
        separation_method_map = {
            "newline": "\n",
            "space": " ",
            "comma": ",",
            "period": "."
        }

        sm_1_2 = separation_method_map[separation_method_1_2]
        sm_2_3 = separation_method_map[separation_method_2_3]
        sm_3_4 = separation_method_map[separation_method_3_4]
        sm_4_5 = separation_method_map[separation_method_4_5]

        strings = [string_1, string_2, string_3, string_4, string_5]
        separation_methods = [sm_1_2, sm_2_3, sm_3_4, sm_4_5]

        result_parts = []
        for i, string in enumerate(strings):
            if string:
                result_parts.append(string)
                if i < len(separation_methods) and i < len(strings) - 1:
                    if strings[i + 1]:
                        result_parts.append(separation_methods[i])

        grouped_string = "".join(result_parts)

        selected_string = strings[int(select_string) - 1]

        return (grouped_string, selected_string, string_1, string_2, string_3, string_4, string_5)
