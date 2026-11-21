<?php

declare(strict_types=1);

namespace Reader\Domain\Model;

use Catalog\Domain\Model\Genre;
use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\Phone;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Identity\Domain\Model\User;
use Library\Domain\Model\Library;
use Reader\Domain\Enum\ReaderCategory;
use Reader\Domain\Enum\ContactChannel;
use Reader\Domain\Enum\MembershipStatus;
use Reader\Domain\Exception\IncompleteProfileException;
use Reader\Domain\Model\Embeddable\Address;
use SharedKernel\Domain\Model\Country;
use SharedKernel\Domain\Model\Language;

#[ORM\Entity]
#[ORM\Table(name: 'reader')]
class Reader implements \Stringable
{
    use IdentityTrait;
    use TimestampableTrait;

    public const int ADULT_AGE = 18;

    public const int MEMBERSHIP_DURATION_MONTHS = 12;

    /** @var list<ReaderCategory> */
    public const FREE_CATEGORIES = [
        ReaderCategory::Child,
        ReaderCategory::Student,
        ReaderCategory::JobSeeker,
    ];

    #[ORM\OneToOne(targetEntity: User::class, mappedBy: 'reader', fetch: 'EAGER')]
    public private(set) ?User $user = null;

    #[ORM\ManyToOne(targetEntity: Library::class)]
    #[ORM\JoinColumn(nullable: false)]
    public private(set) Library $homeLibrary;

    #[ORM\Column(length: 20, enumType: MembershipStatus::class)]
    public private(set) MembershipStatus $membershipStatus;

    #[ORM\Column(length: 20, enumType: ReaderCategory::class)]
    public private(set) ReaderCategory $category;

    #[ORM\Column(length: 32, unique: true)]
    public private(set) string $cardNumber;

    #[ORM\Column(length: 255)]
    public private(set) string $lastName;

    #[ORM\Column(length: 255)]
    public private(set) string $firstName;

    #[ORM\Column(type: 'date_immutable')]
    public private(set) \DateTimeImmutable $birthDate;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $email = null;

    #[ORM\Column(type: 'phone', length: 20)]
    public private(set) Phone $mobilePhone;

    #[ORM\Column(type: 'phone', length: 20, nullable: true)]
    public private(set) ?Phone $landlinePhone = null;

    #[ORM\Embedded(class: Address::class, columnPrefix: 'address_')]
    public private(set) Address $address;

    #[ORM\ManyToOne(targetEntity: Country::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Country $birthCountry = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $guardianLastName = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $guardianFirstName = null;

    #[ORM\Column(length: 20, nullable: true)]
    public private(set) ?string $guardianPhone = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $guardianEmail = null;

    #[ORM\Column(enumType: ContactChannel::class)]
    public private(set) ContactChannel $preferredContactChannel;

    #[ORM\Column]
    public private(set) bool $acceptsNewsletter = false;

    #[ORM\Column]
    public private(set) bool $acceptsSmsReminders = false;

    #[ORM\Column]
    public private(set) bool $digitalAccess = false;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $membershipStartDate = null;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $membershipEndDate = null;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $suspensionDate = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $suspensionReason = null;

    #[ORM\Column]
    public private(set) int $lateCount = 0;

    #[ORM\Column]
    public private(set) int $penaltyAmountCents = 0;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $lastVisit = null;

    /** @var Collection<int, Language> */
    #[ORM\ManyToMany(targetEntity: Language::class)]
    #[ORM\JoinTable(name: 'reader_language')]
    public private(set) Collection $readingLanguages;

    /** @var Collection<int, Genre> */
    #[ORM\ManyToMany(targetEntity: Genre::class)]
    #[ORM\JoinTable(name: 'reader_favorite_genre')]
    public private(set) Collection $favoriteGenres;

    /** @var Collection<int, Loan> */
    #[ORM\OneToMany(targetEntity: Loan::class, mappedBy: 'reader')]
    public private(set) Collection $loans;

    /** @var Collection<int, Reservation> */
    #[ORM\OneToMany(targetEntity: Reservation::class, mappedBy: 'reader', orphanRemoval: true)]
    public private(set) Collection $reservations;

    public function __construct(
        Library $homeLibrary,
        string $cardNumber,
        string $lastName,
        string $firstName,
        \DateTimeImmutable $birthDate,
        string $mobilePhone,
        Address $address,
        ReaderCategory $category,
    ) {
        $this->homeLibrary = $homeLibrary;
        $this->cardNumber = $cardNumber;
        $this->lastName = $lastName;
        $this->firstName = $firstName;
        $this->birthDate = $birthDate;
        $this->mobilePhone = Phone::fromString($mobilePhone);
        $this->address = $address;
        $this->category = $category;
        $this->membershipStatus = MembershipStatus::Pending;
        $this->preferredContactChannel = ContactChannel::Email;
        $this->readingLanguages = new ArrayCollection();
        $this->favoriteGenres = new ArrayCollection();
        $this->loans = new ArrayCollection();
        $this->reservations = new ArrayCollection();
    }

    public function isMinor(\DateTimeImmutable $today = new \DateTimeImmutable()): bool
    {
        return $this->birthDate->diff($today)->y < self::ADULT_AGE;
    }

    public function isFree(): bool
    {
        return \in_array($this->category, self::FREE_CATEGORIES, true);
    }

    public function setGuardian(string $lastName, string $firstName, string $phone, ?string $email): void
    {
        $this->guardianLastName = $lastName;
        $this->guardianFirstName = $firstName;
        $this->guardianPhone = $phone;
        $this->guardianEmail = $email;
    }

    private function isProfileComplete(): bool
    {
        if ($this->isMinor() && null === $this->guardianLastName) {
            return false;
        }

        return null !== $this->email || ContactChannel::Mail === $this->preferredContactChannel;
    }

    public function activate(\DateTimeImmutable $start): void
    {
        if (MembershipStatus::Pending !== $this->membershipStatus) {
            throw new \LogicException('Only a pending membership can be activated.');
        }

        if (!$this->isProfileComplete()) {
            throw new IncompleteProfileException($this->cardNumber);
        }

        $this->membershipStatus = MembershipStatus::Active;
        $this->membershipStartDate = $start;
        $this->membershipEndDate = $start->modify(\sprintf('+%d months', self::MEMBERSHIP_DURATION_MONTHS));
    }

    public function renew(): void
    {
        if (!\in_array($this->membershipStatus, [MembershipStatus::Active, MembershipStatus::Expired], true)) {
            throw new \LogicException('Only an active or expired membership can be renewed.');
        }

        $from = $this->membershipEndDate > new \DateTimeImmutable() ? $this->membershipEndDate : new \DateTimeImmutable();
        \assert(null !== $from);

        $this->membershipStatus = MembershipStatus::Active;
        $this->membershipEndDate = $from->modify(\sprintf('+%d months', self::MEMBERSHIP_DURATION_MONTHS));
    }

    public function expire(\DateTimeImmutable $today): void
    {
        if (MembershipStatus::Active !== $this->membershipStatus) {
            throw new \LogicException('Only an active membership can expire.');
        }

        if (null === $this->membershipEndDate || $this->membershipEndDate > $today) {
            throw new \LogicException('The membership is still running.');
        }

        $this->membershipStatus = MembershipStatus::Expired;
    }

    public function isMembershipActive(): bool
    {
        return MembershipStatus::Active === $this->membershipStatus;
    }

    public function isSuspended(): bool
    {
        return MembershipStatus::Suspended === $this->membershipStatus;
    }

    public function canBorrow(): bool
    {
        return $this->isMembershipActive() && 0 === $this->penaltyAmountCents;
    }

    public function recordVisit(\DateTimeImmutable $when): void
    {
        $this->lastVisit = $when;
    }

    public function recordLate(int $penaltyCents): void
    {
        ++$this->lateCount;
        $this->penaltyAmountCents += $penaltyCents;
    }

    public function settlePenalties(int $amountCents): void
    {
        if ($amountCents > $this->penaltyAmountCents) {
            throw new \InvalidArgumentException('The payment exceeds the amount due.');
        }

        $this->penaltyAmountCents -= $amountCents;
    }

    public function hasOngoingLoans(): bool
    {
        foreach ($this->loans as $loan) {
            if ($loan->isOngoing()) {
                return true;
            }
        }

        return false;
    }

    public function countOngoingLoans(): int
    {
        return $this->loans->filter(static fn (Loan $loan): bool => $loan->isOngoing())->count();
    }

    public function addReservation(Reservation $reservation): void
    {
        if (!$this->reservations->contains($reservation)) {
            $this->reservations->add($reservation);
        }
    }

    public function cancelReservation(Reservation $reservation): void
    {
        $this->reservations->removeElement($reservation);
    }

    /**
     * @param list<Language> $languages
     */
    public function updateReadingLanguages(array $languages): void
    {
        $this->readingLanguages->clear();
        foreach ($languages as $language) {
            $this->readingLanguages->add($language);
        }
    }

    /**
     * @param list<Genre> $genres
     */
    public function updateFavoriteGenres(array $genres): void
    {
        $this->favoriteGenres->clear();
        foreach ($genres as $genre) {
            $this->favoriteGenres->add($genre);
        }
    }

    public function updateContactPreferences(ContactChannel $channel, bool $newsletter, bool $smsReminders): void
    {
        $this->preferredContactChannel = $channel;
        $this->acceptsNewsletter = $newsletter;
        $this->acceptsSmsReminders = $smsReminders;
    }

    public function updateContactDetails(
        ?string $email,
        string $mobilePhone,
        ?string $landlinePhone,
        Address $address,
    ): void {
        $this->email = $email;
        $this->mobilePhone = Phone::fromString($mobilePhone);
        $this->landlinePhone = null !== $landlinePhone ? Phone::fromString($landlinePhone) : null;
        $this->address = $address;
    }

    public function changeCategory(ReaderCategory $category): void
    {
        $this->category = $category;
    }

    public function transferTo(Library $library): void
    {
        if ($this->hasOngoingLoans()) {
            throw new \LogicException('A reader with ongoing loans cannot change library.');
        }

        $this->homeLibrary = $library;
    }

    public function openDigitalAccess(): void
    {
        if (!$this->isMembershipActive()) {
            throw new \LogicException('Digital access requires an active membership.');
        }

        $this->digitalAccess = true;
    }

    public function closeDigitalAccess(): void
    {
        $this->digitalAccess = false;
    }

    public function suspend(string $reason, \DateTimeImmutable $when): void
    {
        $this->membershipStatus = MembershipStatus::Suspended;
        $this->suspensionReason = $reason;
        $this->suspensionDate = $when;
        $this->digitalAccess = false;
    }

    public function lift(): void
    {
        if (MembershipStatus::Suspended !== $this->membershipStatus) {
            throw new \LogicException('Only a suspended membership can be reinstated.');
        }

        $this->membershipStatus = MembershipStatus::Active;
        $this->suspensionReason = null;
        $this->suspensionDate = null;
    }

    public function terminate(): void
    {
        if (MembershipStatus::Terminated === $this->membershipStatus) {
            throw new \LogicException('This membership is already terminated.');
        }

        if ($this->hasOngoingLoans()) {
            throw new \LogicException('A membership with ongoing loans cannot be terminated.');
        }

        $this->membershipStatus = MembershipStatus::Terminated;
        $this->digitalAccess = false;
        $this->reservations->clear();
    }

    public function archive(): void
    {
        if (MembershipStatus::Terminated !== $this->membershipStatus) {
            throw new \LogicException('Only a terminated membership can be archived.');
        }

        $this->membershipStatus = MembershipStatus::Archived;
        $this->email = null;
        $this->landlinePhone = null;
        $this->acceptsNewsletter = false;
        $this->acceptsSmsReminders = false;
    }

    public function daysUntilExpiration(\DateTimeImmutable $today): ?int
    {
        if (null === $this->membershipEndDate) {
            return null;
        }

        $days = (int) $today->diff($this->membershipEndDate)->format('%r%a');

        return max(0, $days);
    }

    public function categoryLabel(): string
    {
        return match ($this->category) {
            ReaderCategory::Child => 'Child',
            ReaderCategory::Student => 'Student',
            ReaderCategory::JobSeeker => 'Job seeker',
            ReaderCategory::Adult => 'Adult',
            ReaderCategory::Senior => 'Senior',
            ReaderCategory::Institution => 'Institution',
        };
    }

    public function initials(): string
    {
        return mb_strtoupper(mb_substr($this->firstName, 0, 1).mb_substr($this->lastName, 0, 1));
    }

    public function fullName(): string
    {
        return $this->firstName.' '.$this->lastName;
    }

    public function setUser(?User $user): void
    {
        $this->user = $user;
    }

    #[\Override]
    public function __toString(): string
    {
        return \sprintf('%s (%s)', $this->fullName(), $this->cardNumber);
    }
}
