#ifndef CHOPSTICKS_HPP
#define CHOPSTICKS_HPP

#include <array>
#include <vector>
#include <string>
#include <cstdint>
#include <functional>

namespace chopsticks {

// Forward declarations
struct Hands;
struct Position;
struct Move;

// ============================================================================
// Rule Configuration
// ============================================================================

struct Rules {
    // Maximum fingers per hand (exclusive - hand dies at this value)
    int max_fingers = 5;

    // If true, sum at or above max_fingers wraps (e.g. 3+3=6 -> 1). If false, hand is knocked out (0).
    bool rollover = false;

    // If true, attacks may target a "dead" (0) opponent hand. If false (default), they may not.
    bool death_attack = false;

    // Apply attack result based on rules
    int apply_attack(int target, int attacker) const {
        int result = target + attacker;
        if (result >= max_fingers) {
            return rollover ? (result % max_fingers) : 0;
        }
        return result;
    }

    // Check if a hand is dead
    bool is_dead(int fingers) const {
        return fingers == 0;
    }

    // Check if a hand value is valid (for splits)
    bool is_valid_hand(int fingers) const {
        return fingers >= 0 && fingers < max_fingers;
    }
};

// `rollover` and `death_attack` are independent; all four (off/off, off/on, on/off, on/on) are valid.
// Order in aggregate init: { max_fingers, rollover, death_attack }.
inline const Rules DEFAULT_RULES{5, false, false};
inline const Rules STANDARD_RULES{5, false, false};
inline const Rules ROLLOVER_RULES{5, true, false};
inline const Rules DEATH_ATTACK_RULES{5, false, true};
inline const Rules ROLLOVER_AND_DEATH_ATTACK_RULES{5, true, true};

// ============================================================================
// Hands - represents one player's two hands
// ============================================================================

struct Hands {
    std::array<uint8_t, 2> fingers;  // Always normalized: fingers[0] <= fingers[1]
    
    Hands() : fingers{0, 0} {}
    Hands(int a, int b) {
        if (a <= b) {
            fingers = {static_cast<uint8_t>(a), static_cast<uint8_t>(b)};
        } else {
            fingers = {static_cast<uint8_t>(b), static_cast<uint8_t>(a)};
        }
    }
    
    uint8_t lo() const { return fingers[0]; }
    uint8_t hi() const { return fingers[1]; }
    int total() const { return fingers[0] + fingers[1]; }
    
    bool is_dead() const { return fingers[0] == 0 && fingers[1] == 0; }
    bool has_living_hand() const { return fingers[0] > 0 || fingers[1] > 0; }
    
    // For use as map key
    bool operator==(const Hands& other) const {
        return fingers == other.fingers;
    }
    bool operator<(const Hands& other) const {
        return fingers < other.fingers;
    }
    
    // Unique index for this hand configuration (0-14 for standard rules)
    int index(const Rules& rules) const {
        // For max_fingers=5: (0,0)=0, (0,1)=1, ..., (4,4)=14
        int idx = 0;
        for (int a = 0; a < rules.max_fingers; ++a) {
            for (int b = a; b < rules.max_fingers; ++b) {
                if (a == fingers[0] && b == fingers[1]) return idx;
                ++idx;
            }
        }
        return -1; // Should never happen
    }
    
    // Create Hands from index
    static Hands from_index(int idx, const Rules& rules) {
        int i = 0;
        for (int a = 0; a < rules.max_fingers; ++a) {
            for (int b = a; b < rules.max_fingers; ++b) {
                if (i == idx) return Hands(a, b);
                ++i;
            }
        }
        return Hands(0, 0);
    }
    
    // Count of possible hand configurations
    static int count(const Rules& rules) {
        int n = rules.max_fingers;
        return n * (n + 1) / 2;
    }
    
    std::string to_string() const {
        return "(" + std::to_string(fingers[0]) + "," + std::to_string(fingers[1]) + ")";
    }
};

// ============================================================================
// Move - represents a single action
// ============================================================================

enum class MoveType { ATTACK, SPLIT };

struct Move {
    MoveType type;
    
    // For ATTACK: which of my hands (0 or 1) attacks which of theirs (0 or 1)
    // For SPLIT: the new hand configuration
    union {
        struct {
            uint8_t my_hand;    // 0 = lo hand, 1 = hi hand
            uint8_t their_hand; // 0 = lo hand, 1 = hi hand
        } attack;
        struct {
            uint8_t new_lo;
            uint8_t new_hi;
        } split;
    };
    
    static Move make_attack(int my_hand, int their_hand) {
        Move m;
        m.type = MoveType::ATTACK;
        m.attack.my_hand = my_hand;
        m.attack.their_hand = their_hand;
        return m;
    }
    
    static Move make_split(int new_lo, int new_hi) {
        Move m;
        m.type = MoveType::SPLIT;
        if (new_lo <= new_hi) {
            m.split.new_lo = new_lo;
            m.split.new_hi = new_hi;
        } else {
            m.split.new_lo = new_hi;
            m.split.new_hi = new_lo;
        }
        return m;
    }
    
    bool operator==(const Move& other) const {
        if (type != other.type) return false;
        if (type == MoveType::ATTACK) {
            return attack.my_hand == other.attack.my_hand && 
                   attack.their_hand == other.attack.their_hand;
        } else {
            return split.new_lo == other.split.new_lo && 
                   split.new_hi == other.split.new_hi;
        }
    }
    
    std::string to_string() const {
        if (type == MoveType::ATTACK) {
            return "ATK(" + std::to_string(attack.my_hand) + "->" + 
                   std::to_string(attack.their_hand) + ")";
        } else {
            return "SPLIT(" + std::to_string(split.new_lo) + "," + 
                   std::to_string(split.new_hi) + ")";
        }
    }
};

// ============================================================================
// Position - full game state
// ============================================================================

struct Position {
    Hands current;   // Player to move
    Hands opponent;  // Player who just moved
    
    Position() = default;
    Position(Hands c, Hands o) : current(c), opponent(o) {}
    
    // Starting position
    static Position initial() {
        return Position(Hands(1, 1), Hands(1, 1));
    }
    
    // Check if this is a terminal position (current player has lost)
    bool is_terminal() const {
        return current.is_dead();
    }
    
    // Unique index for this position
    int index(const Rules& rules) const {
        int hands_count = Hands::count(rules);
        return current.index(rules) * hands_count + opponent.index(rules);
    }
    
    // Create position from index
    static Position from_index(int idx, const Rules& rules) {
        int hands_count = Hands::count(rules);
        int current_idx = idx / hands_count;
        int opponent_idx = idx % hands_count;
        return Position(
            Hands::from_index(current_idx, rules),
            Hands::from_index(opponent_idx, rules)
        );
    }
    
    // Total number of positions
    static int count(const Rules& rules) {
        int h = Hands::count(rules);
        return h * h;
    }
    
    // Generate all legal moves from this position
    std::vector<Move> legal_moves(const Rules& rules) const;
    
    // Apply a move and return the new position (with sides swapped)
    Position apply_move(const Move& move, const Rules& rules) const;
    
    bool operator==(const Position& other) const {
        return current == other.current && opponent == other.opponent;
    }
    
    std::string to_string() const {
        return "Pos[me=" + current.to_string() + " opp=" + opponent.to_string() + "]";
    }
};

// ============================================================================
// Solution Result
// ============================================================================

enum class Result { UNKNOWN, WIN, LOSS, DRAW };

inline std::string result_to_string(Result r) {
    switch (r) {
        case Result::UNKNOWN: return "UNKNOWN";
        case Result::WIN: return "WIN";
        case Result::LOSS: return "LOSS";
        case Result::DRAW: return "DRAW";
    }
    return "?";
}

struct PositionSolution {
    Result result = Result::UNKNOWN;
    int depth = -1;  // Moves until terminal (for WIN/LOSS), -1 for DRAW/UNKNOWN
    std::vector<Move> best_moves;  // Winning moves (WIN), drawing moves (DRAW), or longest-survival (LOSS)
    
    std::string to_string() const {
        std::string s = result_to_string(result);
        if (depth >= 0) {
            s += " in " + std::to_string(depth);
        }
        if (!best_moves.empty()) {
            s += " [";
            for (size_t i = 0; i < best_moves.size(); ++i) {
                if (i > 0) s += ", ";
                s += best_moves[i].to_string();
            }
            s += "]";
        }
        return s;
    }
};

// ============================================================================
// Solver
// ============================================================================

class Solver {
public:
    explicit Solver(const Rules& rules = DEFAULT_RULES);
    
    // Solve all positions
    void solve();
    
    // Get solution for a specific position
    const PositionSolution& get_solution(const Position& pos) const;
    const PositionSolution& get_solution(int pos_index) const;
    
    // Get all solutions
    const std::vector<PositionSolution>& get_all_solutions() const { return solutions_; }
    
    // Access rules
    const Rules& rules() const { return rules_; }
    
    // Statistics
    int count_wins() const;
    int count_losses() const;
    int count_draws() const;
    int total_positions() const { return Position::count(rules_); }
    
    // Export to SQLite
    void export_to_sqlite(const std::string& filename) const;

private:
    Rules rules_;
    std::vector<PositionSolution> solutions_;
    bool solved_ = false;
    
    void initialize_terminals();
    void propagate();
    void classify_draws();
    void compute_best_moves();
};

// BFS from standard start; both players may play any legal move. Returns count
// of distinct position indices seen.
int count_reachable_states(const Rules& rules);

} // namespace chopsticks

#endif // CHOPSTICKS_HPP
